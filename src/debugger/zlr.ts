"use strict";

// tslint:disable:member-ordering

import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import freeport = require("freeport-promise");
import { Socket } from "net";
import * as path from "path";
import * as process from "process";
import { Readable, Writable } from "stream";
import stripBomStream = require("strip-bom-stream");
import { LogLevel } from "vscode-debugadapter/lib/logger";
import { DebugSession, logger } from "vscode-debugadapter/lib/main";
import { DebugProtocol } from "vscode-debugprotocol/lib/debugProtocol";

import * as fs from "../shared/async/fs";
import * as RX from "./regExp";
import { ZcodeAddress } from "./regExp";
import { StreamCatcher } from "./streamCatcher";

export interface ZVariable {
    name: string;
    rawValue: string;
    type?: string;
    value: any;
}

export interface ZObject {
    name?: string;
    number: number;
    desc: string;
}

export interface ZTreeObject extends ZObject {
    parent?: ZTreeObject;
    children: ZTreeObject[];
}

export interface ZAttribute {
    name?: string;
    number: number;
}

export interface ZProperty {
    name?: string;
    number: number;
    length: number;
    data: number[];
}

export interface ZDetailObject extends ZObject {
    parent?: ZObject;
    sibling?: ZObject;
    child?: ZObject;
    attributes: ZAttribute[];
    propertyTable?: string;
    properties: ZProperty[];
}

// TODO: use LaunchRequestArguments directly
interface LaunchOptions {
    exec: string;
    cwd?: string;
    env?: { [key: string]: string; };
    storyFile: string;
    debugFile?: string;
    options: {
        predictableRandom?: boolean;
        console?: "integratedTerminal" | "externalTerminal";
        extraArgs?: string[];
    };
}

export interface ZStackFrame {
    depth?: number;
    pc?: ZcodeAddress;
}

export interface RequestResponse {
    /** Raw response from the debugger. */
    orgData: string[];
    /** Body of the response, after parsing. */
    data: string[];
    /** Command that triggered the response. */
    command?: string;

    /** Current line when paused. */
    ln: number;
    /** Current file basename when paused. */
    name: string;
    /** Current file path from debug file when paused. */
    filename: string;
    /** The reason why the debugger is paused. */
    pauseReason?: RX.PauseReason;

    /** Set if debugger is paused because of an exception. */
    exception?: { type: string, message: string };
    /** True if debuggee has terminated. */
    finished: boolean;
}

export interface Debugger {
    on(event: "output", listener: (s: string) => void): this;
    on(event: "close", listener: (code: number) => void): this;
    on(event: "exception" | "termination", listener: (res: RequestResponse) => void): this;
    on(event: "spawnInTerminal", listener: DebugSession["runInTerminalRequest"]): this;

    once(event: "output", listener: (s: string) => void): this;
    once(event: "close", listener: (code: number) => void): this;
    once(event: "exception" | "termination", listener: (res: RequestResponse) => void): this;
    once(event: "spawnInTerminal", listener: DebugSession["runInTerminalRequest"]): this;

    emit(event: "output", s: string): boolean;
    emit(event: "close", code: number): boolean;
    emit(event: "exception" | "termination", res: RequestResponse): boolean;
    emit(event: "spawnInTerminal", args: DebugProtocol.RunInTerminalRequestArguments, timeout: number,
         cb: (response: DebugProtocol.RunInTerminalResponse) => void): boolean;
}

export class Debugger extends EventEmitter {
    private zlrProcess?: ChildProcess;
    public streamCatcher: StreamCatcher;
    public commandRunning: string = "";

    private filename?: string;
    private rootPath: string = process.cwd();       // XXX need to set this correctly
    private currentFile?: string;

    constructor() {
        super();
        this.streamCatcher = new StreamCatcher();
    }

    public shutdown() {
        if (this.streamCatcher) {
            this.streamCatcher.interruptIfBusy("!pause");
            this.streamCatcher.interrupt("quit");
            this.streamCatcher.shutdown();
            delete this.streamCatcher;
        }
        if (this.zlrProcess) {
            this.zlrProcess.kill();
            delete this.zlrProcess;
        }
    }

    public async initializeRequest() {
        // nada
    }

    public logOutput(data: string) {
        this.emit("output", data);
    }

    public logData(prefix: string, data: string[]) {
        data.forEach((val, i) => {
            this.logOutput(`${prefix}${val}`);
        });
    }

    public async parseResponse(data: string[]): Promise<RequestResponse> {
        const res: RequestResponse = {
            command: "",
            data: [],
            filename: "",
            finished: false,
            ln: 0,
            name: "",
            orgData: data,
        };

        for (let i = 0; i < res.orgData.length; i++) {
            let line = res.orgData[i];
            if (i === 0) {
                // Command line
                res.command = line;
            } else if (i === res.orgData.length - 1) {
                // Next prompt
                if (!RX.lastCommandLine.test(line)) {
                    logger.warn(`Unexpected last line of response: ${line}`);
                }
            } else {
                // Current location?
                if (i >= res.orgData.length - 3) {
                    const line2 = i < res.orgData.length - 2 ? res.orgData[i + 1] : undefined;
                    const { linesUsed, location } = RX.matchCurrentLocation(line, line2);
                    if (location && location.source) {
                        res.filename = location.source.file;
                        res.name = path.basename(location.source.file);
                        res.ln = location.source.line;
                    }
                    if (linesUsed) {
                        i += linesUsed - 1;
                        continue;
                    }
                }

                // Contents
                line = line.replace(RX.colors, "");
                if (!RX.isGarbageLine(line)) {
                    res.data!.push(line);
                }

                let m: RegExpExecArray | null;

                // tslint:disable:no-conditional-assignment
                if (RX.programCondition.terminated.test(line)) {
                    res.finished = true;
                } else if (m = RX.programCondition.exception.exec(line)) {
                    res.exception = { type: m[1], message: m[2] };
                } else if (m = RX.programCondition.paused.exec(line)) {
                    const explanation = m[1];
                    for (const reason of RX.programCondition.pauseReasons) {
                        if (RX.programCondition.pauseReasonPatterns[reason].test(explanation)) {
                            res.pauseReason = reason;
                            break;
                        }
                    }
                }
                // tslint:enable:no-conditional-assignment
            }
        }

        if (res.exception) {
            this.emit("exception", res);
        } else if (res.finished) {
            this.emit("termination", res);
        }

        if (res.exception) {
            throw res;
        }

        return res;
    }

    public async launchRequest(options: LaunchOptions): Promise<RequestResponse> {
        const cwd = options.cwd || process.cwd();
        const storyFile = options.storyFile;
        const debugFile = options.debugFile;

        this.rootPath = path.dirname(path.resolve(cwd, storyFile));
        this.filename = this.currentFile = storyFile;

        logger.verbose(`Platform: ${process.platform}`);

        logger.verbose(`Launch ZLR to debug "${storyFile}" in "${cwd}"`);

        // Verify file and folder existence
        // xxx: We can improve the error handling
        if (!await fs.exists(storyFile)) { logger.error(`File ${storyFile} not found`); }
        if (cwd && !await fs.exists(cwd)) { logger.error(`Folder ${cwd} not found`); }

        const zlrCommand = options.exec;

        const commandArgs = ["-debug", "-nowait"];
        if (options.options.predictableRandom) { commandArgs.push("-predictable"); }
        if (options.options.extraArgs) { commandArgs.push(...options.options.extraArgs); }
        commandArgs.push(storyFile);
        if (debugFile) { commandArgs.push(debugFile); }

        const quoteIfNeeded = (s: string) => s.indexOf(" ") >= 0 ? `"${s}"` : s;
        this.commandRunning = `${zlrCommand} ${commandArgs.map(quoteIfNeeded).join(" ")}`;
        this.logOutput(this.commandRunning);

        // Spawn and connect to debugger process
        const consoleType = options.options.console || "integratedTerminal";
        const [toZlr, fromZlr] = await this.spawnDebugger(zlrCommand, commandArgs, cwd, options.env, consoleType);
        this.streamCatcher.launch(toZlr, fromZlr /* stderr */);

        // Handle program output
        fromZlr.on("data", (buffer) => {
            const lines = buffer.toString().split("\n");
            this.logData("", lines); // xxx: Program output, better formatting/colors?
        });

        fromZlr.on("close", (code: number) => {
            this.commandRunning = "";
            if (this.streamCatcher.ready) {
                this.logOutput(`Debugger connection closed`);
            } else {
                this.logOutput(`Could not connect to debugger, connection closed`);
            }
            this.emit("close", code);
        });

        // Listen for a ready signal
        const data = await this.streamCatcher.whenReady();
        this.logData("", data.slice(0, data.length - 2));
        return this.parseResponse(data);
    }

    protected spawnDebugger(
        command: string, args: string[], cwd: string | undefined, env: {} | undefined,
        consoleType: "integratedTerminal" | "externalTerminal",
    ): Promise<[Writable, Readable]> {
        // TODO: use child process if IDE doesn't support spawn in terminal?
        // return this.spawnDebuggerInChildProcess(command, args, cwd, env);

        return this.spawnDebuggerInTerminal(command, args, cwd, env, consoleType);
    }

    private async spawnDebuggerInTerminal(
        command: string, args: string[], cwd: string | undefined, env: {} | undefined,
        consoleType: "integratedTerminal" | "externalTerminal",
    ): Promise<[Writable, Readable]> {
        const zlrPort = await freeport();
        await new Promise((resolve, reject) => {
            // TODO: let user customize port?
            const spawnArgs: DebugProtocol.RunInTerminalRequestArguments = {
                args: [command, "-listen", zlrPort.toString(), ...args],
                cwd: cwd || process.cwd(),
                env,
                kind: consoleType === "externalTerminal" ? "external" : "integrated",
                title: "Z-Machine Debugger",
            };
            const spawnTimeout = 5000;
            const spawnCallback = (res: DebugProtocol.RunInTerminalResponse) => {
                if (res.success) {
                    resolve(res.body && res.body.processId);
                } else {
                    reject(res.message);
                }
            };
            if (!this.emit("spawnInTerminal", spawnArgs, spawnTimeout, spawnCallback)) {
                throw new Error("No spawn listener");
            }
        });
        const client = new Socket();
        client.on("close", () => { /* nada */ });
        client.on("error", () => { /* nada */ });
        await new Promise((resolve, reject) => client.connect(zlrPort, "127.0.0.1", () => resolve()));
        return [client, client.pipe(stripBomStream())];
    }

    private spawnDebuggerInChildProcess(
        command: string, args: string[], cwd: string | undefined, env: {} | undefined,
    ): [Writable, Readable] {
        const spawnOptions: SpawnOptions = {
            cwd: cwd || undefined,
            detached: true,
            env: {
                COLUMNS: 80,
                LINES: 25,
                TERM: "dumb",
                ...env,
            },
        };
        this.zlrProcess = spawn(command, args, spawnOptions);
        this.zlrProcess.on("error", (err) => {
            logger.error(err.toString());
            logger.verbose(`DUMP: spawn(${command}, ${JSON.stringify(args)}, ` +
                `${JSON.stringify(spawnOptions)});`);
        });
        return [this.zlrProcess.stdin, this.zlrProcess.stdout];
    }

    protected async request(command: string) {
        await this.streamCatcher.whenReady();
        return this.parseResponse(await this.streamCatcher.request(command));
    }

    protected async interrupt(command: string) {
        await this.streamCatcher.whenReady();
        return this.streamCatcher.interrupt(command);
    }

    // in theory, these could consult ZLR to match against the paths in the debug info file
    public async convertClientPathToDebugger(filename: string) {
        await this.streamCatcher.whenReady();
        return path.relative(this.rootPath, filename);
    }

    public async convertDebuggerPathToClient(filename: string) {
        await this.streamCatcher.whenReady();
        return path.resolve(this.rootPath, filename);
    }

    public async setBreakPoint(func: string): Promise<DebugProtocol.Breakpoint>;
    public async setBreakPoint(ln: number, filename: string): Promise<DebugProtocol.Breakpoint>;

    public async setBreakPoint(funcOrLn: string | number, filename?: string): Promise<DebugProtocol.Breakpoint> {
        const command = typeof funcOrLn === "string" ? `b ${funcOrLn}` : `b ${filename}:${funcOrLn}`;
        const res = await this.request(command);

        if (res.data.length) {
            const m = RX.matchBreakPointConfirmation(res.data[0]);
            if (m) {
                return {
                    line: m.source && m.source.line,
                    message: `${m.address} (${m.routineOffset || "no source line"})`,
                    source: m.source && {
                        name: m.source.file,
                        path: await this.convertDebuggerPathToClient(m.source.file),
                    },
                    verified: !!m.source,
                };
            }
        }

        throw new Error(
            res.data.length
                ? `Bad response to "${command}": ${res.data[0]}`
                : `No response to "${command}"`);
    }

    public async getBreakPoints() {
        const res = await this.request(`bps`);
        const breakpoints = new Map<string, Array<{ line: number; address: string; routineOffset: string }>>();

        for (const line of res.data) {
            if (RX.breakpoints.ignore.test(line)) { continue; }
            const zaddr = RX.matchZcodeAddress(line);
            if (!zaddr) { break; }
            if (zaddr.routineOffset && zaddr.source) {
                let bpsInFile = breakpoints.get(zaddr.source.file);
                if (typeof bpsInFile === "undefined") {
                    bpsInFile = [];
                    breakpoints.set(zaddr.source.file, bpsInFile);
                }
                bpsInFile.push({
                    address: zaddr.address,
                    line: zaddr.source.line,
                    routineOffset: zaddr.routineOffset,
                });
            }
        }
        return breakpoints;
    }

    public async clearBreakPoint(func: string): Promise<boolean>;
    public async clearBreakPoint(ln: number, filename: string): Promise<boolean>;

    public async clearBreakPoint(funcOrLn: string | number, filename?: string): Promise<boolean> {
        const command = typeof funcOrLn === "string" ? `c ${funcOrLn}` : `c ${filename}:${funcOrLn}`;
        const res = await this.request(command);

        if (res.data.length) {
            const m = RX.matchBreakPointConfirmation(res.data[0]);
            if (m) { return true; }
        }

        throw new Error(
            res.data.length
                ? `Bad response to "${command}": ${res.data[0]}`
                : `No response to "${command}"`);
    }

    public async continue() {
        return await this.request("r");
    }

    public async pause() {
        return await this.interrupt("!pause");
    }

    public async stepIn() {
        return await this.request("sl");
    }

    public async stepOver() {
        return await this.request("ol");
    }

    public async stepOut() {
        return await this.request("up");
    }

    public async restart() {
        return await this.request("reset");
    }

    public async evaluateExpression(expression: string) {
        const res = await this.request(`p ${expression}`);
        return RX.matchPrintedExpression(res.data[0]);
    }

    public async evaluateCommandLine(command: string) {
        return await this.request(command);
    }

    public async getLocalVariables(level: number): Promise<ZVariable[]> {
        const res = await this.request(level > 0 ? `locals ${level}` : "locals");
        const result: ZVariable[] = [];

        for (const line of res.data) {
            // 1 local variable:
            //     RESP = 0 ($0000)
            // No data on stack.
            if (RX.localVars.ignore.test(line)) { continue; }
            const m = line.match(RX.localVars.variable);
            if (!m) { break; }
            const [, name, rawValue, value] = m;
            result.push({ name, rawValue, value });
        }

        return result;
    }

    public async getGlobalVariables(): Promise<ZVariable[]> {
        const res = await this.request("globals");
        const result: ZVariable[] = [];

        for (const line of res.data) {
            //     HERE = 0 ($0000)
            const m = line.match(RX.globalVars.variable);
            if (!m) { break; }
            const [, name, rawValue, value] = m;
            result.push({ name, rawValue, value });
        }

        return result;
    }

    public async getObjectTree(): Promise<ZTreeObject[]> {
        const res = await this.request("tree");
        const result: ZTreeObject[] = [];
        let lastDepth = -1;
        let lastObj: ZTreeObject | undefined;
        const parentByDepth = new Map<number, ZTreeObject>();

        for (const line of res.data) {
            // - MANY-OBJECTS #226 ("those things")
            // - #224 ("")
            //   |- #2 ("large cave bear")
            //   |- INSIDE-BUILDING #213 ("Inside Building")
            //   |  |- BOTTLE #207 ("bottle")
            //   |  |  `- WATER-IN-BOTTLE #206 ("bottled water")
            //   |  `- SEWER-PIPES #211 ("pair of 1 foot diameter sewer pipes")
            //   `- PSEUDO-OBJECT #227 ("that")
            const m = line.match(RX.objectTree.object);
            if (!m) { break; }
            const [, prefix, name, number, desc] = m;
            const depth = prefix.length;
            if (depth > lastDepth) {
                if (lastObj) {
                  parentByDepth.set(depth, lastObj);
                }
                lastDepth = depth;
            }
            const parent = parentByDepth.get(depth);
            const obj: ZTreeObject = {
                children: [],
                desc,
                name,
                number: +number,
                parent: parentByDepth.get(depth),
            };
            if (obj.parent) { obj.parent.children.push(obj); }
            result.push(obj);
            lastObj = obj;
        }

        return result;
    }

    public async getObjectDetails(obj: number | string): Promise<ZDetailObject> {
        const res = await this.request(`showobj ${obj}`);
        const result: ZDetailObject = {
            attributes: [],
            desc: "",
            number: 0,
            properties: [],
        };
        let lastProp: ZProperty | undefined;

        for (const line of res.data) {
            if (RX.objectDetails.ignore.test(line)) { continue; }
            let m: RegExpMatchArray | null;
            // tslint:disable:no-conditional-assignment
            if (m = line.match(RX.objectDetails.objectHeader)) {
                // object header
                const [, name, number, desc] = m;
                result.desc = desc;
                result.name = name;
                result.number = +number;
            } else if (m = line.match(RX.objectDetails.treePointer)) {
                // parent, sibling, or child
                const [, kind, name, number, desc] = m;
                const target = { desc, name, number: +number };
                switch (kind.toLowerCase()) {
                    case "parent": result.parent = target; break;
                    case "sibling": result.sibling = target; break;
                    case "child": result.child = target; break;
                    default: throw new Error(`unexpected object pointer "${kind}"`);
                }
            } else if (m = line.match(RX.objectDetails.propTableHeader)) {
                // property table header
                const [, address] = m;
                result.propertyTable = address;
            } else if (m = line.match(RX.objectDetails.propHeader)) {
                // property header
                const [, name, number, length] = m;
                lastProp = { data: [], length: +length, name, number: +number };
                result.properties.push(lastProp);
            } else if (RX.objectDetails.propData.test(line)) {
                // property data hex dump
                if (lastProp) {
                    const bytes = line.trim().split(/\s+/).map((hex) => parseInt(hex, 16));
                    lastProp.data.push(...bytes);
                }
            } else if (m = line.match(RX.objectDetails.attribute)) {
                // attribute
                const [, name, number] = m;
                result.attributes.push({ name, number: +number });
            } else {
                break;
            }
            // tslint:enable:no-conditional-assignment
        }

        return result;
    }

    public async getStackTrace(): Promise<ZStackFrame[]> {
        const res = await this.request("bt");
        const result: ZStackFrame[] = [];

        for (const line of res.data) {
            // Call depth: 3
            // PC = $0480d (GETWORD?+15, ..\..\Library\parser.zil:278)
            // ==========
            // [1] return PC = $04f86 (PARSER+134, ..\..\Library\parser.zil:736)
            // called with 1 arg, stack depth 8
            // storing result to stack
            // ==========
            if (RX.stackTrace.ignore.test(line)) { continue; }
            const m = line.match(RX.stackTrace.frame);
            if (!m) { break; }
            const [, depth, pc] = m;
            const zaddr = RX.matchZcodeAddress(pc);
            if (!zaddr) { continue; }
            result.push({ depth: depth === undefined ? undefined : +depth, pc: zaddr });
        }

        return result;
    }
}
