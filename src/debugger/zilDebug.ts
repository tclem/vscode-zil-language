"use strict";

import { EventEmitter } from "events";
import * as path from "path";
import {
    Breakpoint, BreakpointEvent, DebugSession, Event, Handles, InitializedEvent, Logger, logger, LoggingDebugSession,
    OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, Variable,
} from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol";

import * as msgs from "./messages";
import {
    GlobalScopeContainer, LocalScopeContainer, ObjectScopeContainer, VariableContainer, VariableHostSession,
} from "./variables";
import {
    Debugger, RequestResponse, ZObject, ZProperty, ZStackFrame, ZTreeObject, ZVariable,
} from "./zlr";

/// <reference types="node" />

/**
 * This interface should always match the schema found in the extension manifest.
 * TODO: move this to the shared folder
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    storyFile?: string;         // optional in schema, but filled in by extension
    debugFile?: string;
    stopOnEntry?: boolean;
    predictableRandom?: boolean;
    interpreter?: string;       // optional in schema, but filled in by extension
    interpreterArgs?: string[];
    console?: "integratedTerminal" | "externalTerminal";
    trace?: boolean;

    preLaunchTask?: string; // defined in vscode's JSON schema
}

class ProcessEvent extends Event implements DebugProtocol.ProcessEvent {
    public body!: DebugProtocol.ProcessEvent["body"];

    constructor(name: string, startMethod?: "launch" | "attach" | "attachForSuspendedLaunch") {
        super("process", { name, startMethod });
    }
}

class ZilDebugSessionEvents extends EventEmitter { }

interface ZilDebugSessionEvents {
    on(event: "paused", listener: (reason: string, exception?: string) => void): this;
    on(event: "running" | "terminated" | "configurationDone", listener: () => void): this;

    once(event: "paused", listener: (reason: string, exception?: string) => void): this;
    once(event: "running" | "terminated" | "configurationDone", listener: () => void): this;

    emit(event: "paused", reason: string, exception?: string): boolean;
    emit(event: "running" | "terminated" | "configurationDone"): boolean;
}

class ZilDebugSession extends LoggingDebugSession {
    private static readonly THREAD_ID = 1;

    protected readonly events = new ZilDebugSessionEvents();

    private nextBreakPointId = 1000;

    private readonly breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();
    private readonly functionBreakPoints = new Array<[string, DebugProtocol.Breakpoint]>();

    private readonly debugger = new Debugger();
    private readonly variableHandles = new Handles<VariableContainer>();
    private get variableHost(): VariableHostSession {
        return { debugger: this.debugger, handles: this.variableHandles };
    }

    private readonly whenConfigurationDone = new Promise((resolve) => {
        this.events.on("configurationDone", resolve);
    });

    private rootPath: string = "";

    public constructor() {
        super("zil_debugger.log");

        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    public shutdown() {
        if (this.debugger) {
            this.debugger.shutdown();
            // delete this.debugger;
        }
        super.shutdown();
    }

    protected convertClientPathToDebugger(clientPath: string): string {
        return path.relative(this.rootPath, clientPath);
    }

    protected convertDebuggerPathToClient(debuggerPath: string): string {
        return path.resolve(this.rootPath, debuggerPath);
    }

    protected async initializeRequest(response: DebugProtocol.InitializeResponse,
                                      args: DebugProtocol.InitializeRequestArguments) {
        this.events.on("running", () => {
            // TODO: tell the IDE to reveal the terminal?
        });

        this.events.on("paused", (reason, exception) => {
            this.variableHandles.reset();
            this.sendEvent(new StoppedEvent(reason, ZilDebugSession.THREAD_ID, exception));
        });

        this.events.on("terminated", () => {
            this.variableHandles.reset();
            this.sendEvent(new TerminatedEvent());
        });

        // Rig output
        // this.debugger.on("output", (text) => {
        //     this.sendEvent(new OutputEvent(`${text}\n`));
        // };

        this.debugger.on("exception", (res) => {
            // TODO: catch exceptions from ZLR
            console.error(res);
        });

        this.debugger.on("termination", (res) => {
            this.events.emit("terminated");
        });

        this.debugger.on("close", (code) => {
            this.events.emit("terminated");
        });

        this.debugger.on("spawnInTerminal", this.runInTerminalRequest.bind(this));

        await this.debugger.initializeRequest();

        response.body = {
            supportTerminateDebuggee: true,
            supportsConditionalBreakpoints: true,
            supportsConfigurationDoneRequest: true,
            supportsEvaluateForHovers: true,
            supportsFunctionBreakpoints: true,
            supportsGotoTargetsRequest: true,
            // supportsRestartRequest: true,
            supportsSetVariable: true,
            // supportsStepBack: true,
            supportsValueFormattingOptions: true,
        };

        this.sendResponse(response);

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent());
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse,
                                             args: DebugProtocol.ConfigurationDoneArguments) {

        this.events.emit("configurationDone");
        this.sendResponse(response);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this.rootPath = path.dirname(args.storyFile!);

        if (args.trace) {
            logger.setup(Logger.LogLevel.Verbose, /*logToFile=*/true);
        } else {
            logger.setup(Logger.LogLevel.Stop, false);
        }

        const res = await this.debugger.launchRequest({
            debugFile: args.debugFile,
            exec: args.interpreter!,
            options: {
                console: args.console,
                extraArgs: args.interpreterArgs,
                predictableRandom: args.predictableRandom,
            },
            storyFile: args.storyFile!,
        });

        await this.whenConfigurationDone;

        this.sendEvent(new ProcessEvent(path.basename(args.storyFile!), "launch"));

        if (args.stopOnEntry) {
            this.sendResponse(response);

            // we stop on the first line
            this.events.emit("paused", res.pauseReason || "unknown");
        } else {
            // we just start to run until we hit a breakpoint or an exception
            this.continueRequest(response as DebugProtocol.ContinueResponse, { threadId: ZilDebugSession.THREAD_ID });
        }
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        console.log("Disconnected. Bye!");
        this.sendResponse(response);
        logger.setup(Logger.LogLevel.Stop);

        if (args.terminateDebuggee !== false) {
            this.debugger.shutdown();
        }
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [
                new Thread(ZilDebugSession.THREAD_ID, "Z-Machine"),
            ],
        };
        this.sendResponse(response);
    }

    /**
     * Reverse continue
     */
    protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse,
                                     args: DebugProtocol.ReverseContinueArguments) {

        this.sendErrorResponse(
            response,
            msgs.FeatureNotImplemented({feature: "Reverse Continue"}),
        );
    }

    /**
     * Step back
     */
    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments) {
        this.sendErrorResponse(
            response,
            msgs.FeatureNotImplemented({feature: "Step Back"}),
        );
    }

    /**
     * Pause
     */

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) {
        try {
            await this.debugger.pause();
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "pauseRequest",
            }));
        }
    }

    /**
     * Set variable
     */
    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse,
                                       args: DebugProtocol.SetVariableArguments) {
        // Get type of variable contents
        try {
            const container = this.variableHandles.get(args.variablesReference);
            if (container) {
                const value = await container.setValue(this.variableHost, args.name, args.value);
                response.body = { value: value.value };
            }
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "setVariableRequest",
            }));
        }
    }

    /**
     * Generic "do some stepping" function
     */
    protected async execute<TResponse extends DebugProtocol.Response, TArgs extends { threadId: number }>(
        response: TResponse, args: TArgs,
        func: (conn: Debugger) => Promise<RequestResponse>,
    ): Promise<void> {
        try {
            const promise = func(this.debugger);
            this.sendResponse(response);

            this.events.emit("running");

            const res = await promise;

            if (res.finished) {
                // TODO: avoid duplicate TerminatedEvent (connection's terminated event sends one too)
                this.events.emit("terminated");
            } else {
                this.events.emit("paused", res.pauseReason || "step");
            }
            // no more lines: run to end
        } catch (err) {
            function isExceptionResponse(rr: any): rr is RequestResponse & { exception: {} } {
                return !!rr.exception;
            }
            if (isExceptionResponse(err)) {
                const { type, message } = err.exception;
                this.events.emit("paused", "exception", `${type}: ${message}`);
            } else {
                logger.error(`execute: ${err}`);
                this.events.emit("terminated");
            }
            if (!response.seq) {
                this.sendErrorResponse(response, msgs.Exception({
                    message: err.message,
                    op: "execute",
                }));
            }
        }
    }

    /**
     * Step out
     */
    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) {
        return this.execute(response, args, (zd) => zd.stepOut());
    }

    /**
     * Step in
     */
    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
        return this.execute(response, args, (zd) => zd.stepIn());
    }

    /**
     * Restart
     */
    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments) {
        try {
            const res = await this.debugger.restart();

            if (res.finished) {
                // TODO: avoid duplicate TerminatedEvent (connection's terminated event sends one too)
                this.events.emit("terminated");
            } else {
                this.events.emit("paused", res.pauseReason || "unknown");
            }

            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "restartRequest",
            }));
        }
    }

    /**
     * Breakpoints
     */
    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {

        // TODO: merge implementations of setBreakPointsRequest and setFunctionBreakPointsRequest

        try {
            const file = args.source.path!;
            const clientLines = args.lines || [];   // TODO: args.lines is deprecated, use args.breakpoints

            const debugPath = await this.debugger.convertClientPathToDebugger(file);
            const editorExisting = this.breakPoints.get(file);
            const editorBPs: number[] = clientLines.map((ln) => this.convertClientLineToDebugger(ln));
            const dbps = await this.debugger.getBreakPoints();
            const debuggerBPs = dbps.get(debugPath) || [];
            const breakpoints = new Array<Breakpoint>();
            const badBreakpoints: DebugProtocol.Breakpoint[] = [];

            // Clean up debugger removing unset bps
            for (const { line } of debuggerBPs) {
                if (editorBPs.indexOf(line) < 0) {
                    await this.debugger.clearBreakPoint(line, debugPath);
                }
            }

            // Add missing bps to the debugger
            for (const ln of editorBPs) {
                let bp: DebugProtocol.Breakpoint;
                const dbp = debuggerBPs.find((i) => i.line === ln);
                if (!dbp) {
                    try {
                        bp = await this.debugger.setBreakPoint(ln, debugPath);
                    } catch (err) {
                        console.log(`Failed to add breakpoint at ${debugPath}:${ln}`);
                        bp = new Breakpoint(false, this.convertDebuggerLineToClient(ln));
                        badBreakpoints.push(bp);
                    }
                } else {
                    // already added
                    bp = new Breakpoint(true, this.convertDebuggerLineToClient(ln)) as DebugProtocol.Breakpoint;

                    // XXX merge with code to set message in debugger.setBreakPoint
                    bp.message = `${dbp.address} (${dbp.routineOffset})`;
                }
                bp.id = this.nextBreakPointId++;
                breakpoints.push(bp);
            }

            this.breakPoints.set(file, breakpoints);

            // send back the actual breakpoint positions
            response.body = {
                breakpoints,
            };

            this.sendResponse(response);

            for (const bbp of badBreakpoints) {
                this.sendEvent(new BreakpointEvent("removed", bbp));
            }
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "setBreakPointsRequest",
            }));
        }
    }

    /**
     * Function breakpoints
     */
    protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse,
                                                  args: DebugProtocol.SetFunctionBreakpointsArguments) {

        try {
            const breakpoints = new Array<[string, DebugProtocol.Breakpoint]>();
            const newBreakpoints = args.breakpoints;
            const badBreakpoints: DebugProtocol.Breakpoint[] = [];

            // remove unset bps
            for (const [name] of this.functionBreakPoints) {
                if (!newBreakpoints.find((nbp) => nbp.name === name)) {
                    await this.debugger.clearBreakPoint(name);
                }
            }

            // add missing bps
            for (const bp of args.breakpoints) {
                let nbp: DebugProtocol.Breakpoint;
                const obp = this.functionBreakPoints.find(([obpName]) => obpName === bp.name);
                if (!obp) {
                    try {
                        nbp = await this.debugger.setBreakPoint(bp.name);
                        if (nbp.line !== undefined) {
                            nbp.line = this.convertDebuggerLineToClient(nbp.line);
                        }
                    } catch (err) {
                        nbp = new Breakpoint(false);
                        badBreakpoints.push(nbp);
                    }
                    nbp.id = this.nextBreakPointId++;
                } else {
                    // already added
                    nbp = obp[1];
                }
                breakpoints.push([bp.name, nbp]);
            }

            this.functionBreakPoints.splice(0, this.functionBreakPoints.length, ...breakpoints);

            response.body = {
                breakpoints: breakpoints.map(([, bp]) => bp),
            };
            this.sendResponse(response);

            for (const bbp of badBreakpoints) {
                this.sendEvent(new BreakpointEvent("removed", bbp));
            }
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "setFunctionBreakPointsRequest",
            }));
        }
    }

    /**
     * Next
     */
    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        return this.execute(response, args, (zd) => zd.stepOver());
    }

    /**
     * Continue
     */
    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        return this.execute(response, args, (zd) => zd.continue());
    }

    /**
     * Scope request
     */
    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        const frameReference = args.frameId;
        const scopes = new Array<Scope>();
        scopes.push(new Scope("Local", this.variableHandles.create(new LocalScopeContainer(args.frameId)), false));
        scopes.push(new Scope("Global", this.variableHandles.create(new GlobalScopeContainer()), false));
        scopes.push(new Scope("Object", this.variableHandles.create(new ObjectScopeContainer()), false));

        response.body = {
            scopes,
        };
        this.sendResponse(response);
    }

    /**
     * Variable scope
     */
    protected async variablesRequest(response: DebugProtocol.VariablesResponse,
                                     args: DebugProtocol.VariablesArguments) {
        try {
            const container = this.variableHandles.get(args.variablesReference);

            if (container) {
                const variables = await container.expand(this.variableHost, "all");
                response.body = { variables };
            }

            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "variablesRequest",
            }));
        }
    }

    /**
     * Evaluate watch
     */
    protected async evaluateWatch(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        const { name, value } = await this.debugger.evaluateExpression(args.expression);
        if (typeof value !== "undefined") {
            response.body = {
                result: value,
                variablesReference: 0,
            };
        }
        this.sendResponse(response);
    }

    /**
     * Evaluate
     */
    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        try {
            if (args.context === "repl") {
                this.evaluateCommandLine(response, args);
            } else if (args.context === "hover") {
                this.evaluateHover(response, args);
            } else if (args.context === "watch") {
                this.evaluateWatch(response, args);
            } else {
                this.sendErrorResponse(
                    response,
                    msgs.UnknownEvalContext({ context: args.context!, expr: args.expression }),
                );
            }
        } catch (err) {
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "evaluateRequest",
            }));
        }
    }

    /**
     * Stack trace
     */
    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse,
                                      args: DebugProtocol.StackTraceArguments) {
        try {
            const stacktrace = await this.debugger.getStackTrace();
            const frames = new Array<StackFrame>();

            const getTraceName = (t: ZStackFrame) => {
                if (!t.pc) {
                    return t.depth ? `<caller ${t.depth}>` : "<top frame>";
                }
                if (t.pc.routineOffset) {
                    return t.pc.routineOffset.split("+")[0];
                }
                return t.pc.address;
            };

            const getTraceSource = (t: ZStackFrame) => {
                if (t.pc && t.pc.source) {
                    return {
                        line: this.convertDebuggerLineToClient(t.pc.source.line),
                        source: new Source(
                            t.pc.source.file,
                            this.convertDebuggerPathToClient(t.pc.source.file)),
                    };
                }
                return {};
            };

            for (const trace of stacktrace) {
                const { source, line } = getTraceSource(trace);
                const frame = new StackFrame(
                    trace.depth || 0,
                    getTraceName(trace),
                    source,
                    line);
                if (!source || !line) {
                    (frame as DebugProtocol.StackFrame).presentationHint = "subtle";
                }
                frames.push(frame);
            }

            response.body = {
                stackFrames: frames,
                totalFrames: frames.length,
            };

            this.sendResponse(response);
        } catch (err) {
            response.body = {
                stackFrames: [],
                totalFrames: 0,
            };
            this.sendErrorResponse(response, msgs.Exception({
                message: err.message,
                op: "stackTraceRequest",
            }));
        }
    }

    /**
     * Evaluate hover
     */
    private async evaluateHover(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        const expression = args.expression;

        const { value } = await this.debugger.evaluateExpression(expression);
        if (value) {
            response.body = {
                result: value,
                variablesReference: 0,
            };
        }
        this.sendResponse(response);
    }

    /**
     * Evaluate command line
     */
    private async evaluateCommandLine(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        const command = args.expression.startsWith("/")
            ? args.expression.substr(1)
            : `p ${args.expression}`;
        const res = await this.debugger.evaluateCommandLine(command);
        if (res.data.length > 1) {
            for (const line of res.data) {
                this.sendEvent(new OutputEvent(`> ${line}\n`));
            }
            response.body = {
                result: `Result:`,
                variablesReference: 0,
            };
        } else {
            response.body = {
                result: `${res.data[0]}`,
                variablesReference: 0,
            };
        }
        this.sendResponse(response);
    }
}

DebugSession.run(ZilDebugSession);
