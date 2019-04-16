"use strict";

import * as path from "path";
import * as vscode from "vscode";

import { exists } from "../shared/async/fs";
import { getBuildTaskLabel, TASK_SOURCE_NAME } from "../shared/tasks";
import { getConfig } from "../util";

type AutoDetect = "on" | "off";
type ZilTaskType = "zilf" | "zapf" | "zilf+zapf";

const ENABLE_ISOLATED_TASKS = false;

interface ZilTaskDefinition extends vscode.TaskDefinition {
    type: ZilTaskType;
    file: string;
    build: "release" | "debug";
}

export function isTaskDefinition(task: any): task is vscode.TaskDefinition {
    return typeof task === "object" && typeof task.type === "string";
}

export function isZilTaskDefinition(task: any): task is ZilTaskDefinition {
    return typeof task === "object"
        && (task.type === "zilf" || task.type === "zapf" || task.type === "zilf+zapf")
        && task.file
        && (task.build === "release" || task.build === "debug");
}

function computeMainFileLocation(ws: vscode.WorkspaceFolder):
    { dir: string, filename: string } | { dir?: undefined, filename?: undefined } {

    const rootPath = ws.uri.scheme === "file" ? ws.uri.fsPath : undefined;
    if (!rootPath) {
        console.log("no rootPath");
        return {};
    }
    return {
        dir: rootPath,
        filename: getConfig(ws).get<string>("mainFile") || path.basename(rootPath) + ".zil",
    };
}

function makeBuildTask(folder: vscode.WorkspaceFolder, identifier: ZilTaskDefinition, title: string, command: string) {
    const options: vscode.ShellExecutionOptions = { cwd: folder.uri.fsPath };
    if (process.platform === "win32") {
        options.executable = "cmd.exe";
        options.shellArgs = ["/d", "/c"];
    }
    const task = new vscode.Task(
        identifier,
        folder,
        title,
        TASK_SOURCE_NAME,
        new vscode.ShellExecution({ value: command, quoting: vscode.ShellQuoting.Strong }, [], options),
        ["$zilf-absolute", "$zilf"],
    );
    task.group = vscode.TaskGroup.Build;
    return task;
}

export async function computeBuildTasks(folder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
    const emptyTasks: vscode.Task[] = [];
    const { dir: rootPath, filename: mainFile } = computeMainFileLocation(folder);
    if (rootPath === undefined || mainFile === undefined) { return emptyTasks; }

    if (!await exists(path.join(rootPath, mainFile))) {
        console.log(`missing mainFile: ${rootPath} // ${mainFile}`);
        return emptyTasks;
    }

    const result: vscode.Task[] = [];
    const localConfig = getConfig(folder);
    const mainZapFile = path.basename(mainFile, ".zil") + ".zap";
    let compilerPath = localConfig.get<string>("compiler.path");
    let assemblerPath = localConfig.get<string>("assembler.path");

    let canCompile = true;
    let canAssemble = true;

    if (!compilerPath || !await exists(compilerPath)) {
        console.log(`missing compiler: ${compilerPath}`);
        canCompile = false;
    } else if (compilerPath.indexOf(" ") !== -1) {
        compilerPath = `"${compilerPath}"`;
    }

    if (!assemblerPath || !await exists(assemblerPath)) {
        console.log(`missing assembler: ${assemblerPath}`);
        canAssemble = false;
    } else if (assemblerPath.indexOf(" ") !== -1) {
        assemblerPath = `"${assemblerPath}"`;
    }

    if (ENABLE_ISOLATED_TASKS) {
        if (canCompile) {
            result.push(makeBuildTask(
                folder,
                { type: "zilf", file: mainFile, build: "release" },
                `Compile ${mainFile}`,
                `${compilerPath} ${mainFile}`,
            ));
        }
        if (canAssemble) {
            result.push(makeBuildTask(
                folder,
                { type: "zapf", file: mainZapFile } as any /* XXX */,
                `Assemble ${mainZapFile}`, `${assemblerPath} ${mainFile}`,
            ));
        }
    }

    if (canCompile && canAssemble) {
        const releaseBuild = makeBuildTask(
            folder,
            { type: "zilf+zapf", file: mainFile, build: "release" },
            getBuildTaskLabel(mainFile, "release"),
            `${compilerPath} ${mainFile} && ${assemblerPath} ${mainZapFile}`,
        );
        const debugBuild = makeBuildTask(
            folder,
            { type: "zilf+zapf", file: mainFile, build: "debug" },
            getBuildTaskLabel(mainFile, "debug"),
            `${compilerPath} -d ${mainFile} && ${assemblerPath} ${mainZapFile}`,
        );
        result.push(releaseBuild, debugBuild);
    }

    return result;
}

class FolderDetector {
    // private fileWatcher: vscode.FileSystemWatcher;
    private promise: Thenable<vscode.Task[]> | undefined;

    constructor(private _workspaceFolder: vscode.WorkspaceFolder) {
    }

    public dispose() {
        this.promise = undefined;
        // if (this.fileWatcher) {
        // 	this.fileWatcher.dispose();
        // }
    }

    public get workspaceFolder(): vscode.WorkspaceFolder {
        return this._workspaceFolder;
    }

    public isEnabled(): boolean {
        return getConfig(this._workspaceFolder).get<AutoDetect>("autoDetect") === "on";
    }

    public start(): void {
        // let pattern = path.join(this._workspaceFolder.uri.fsPath, '[Gg]runtfile.js');
        // this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        // this.fileWatcher.onDidChange(() => this.promise = undefined);
        // this.fileWatcher.onDidCreate(() => this.promise = undefined);
        // this.fileWatcher.onDidDelete(() => this.promise = undefined);
    }

    public async getTasks(): Promise<vscode.Task[]> {
        if (!this.promise) {
            this.promise = computeBuildTasks(this._workspaceFolder);
        }
        return this.promise;
    }

}

class TaskDetector {

    private taskProvider: vscode.Disposable | undefined;
    private detectors: Map<string, FolderDetector> = new Map();

    public start(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
            this.updateWorkspaceFolders(folders, []);
        }
        vscode.workspace.onDidChangeWorkspaceFolders(
            (event) => this.updateWorkspaceFolders(event.added, event.removed));
        vscode.workspace.onDidChangeConfiguration(this.updateConfiguration, this);
    }

    public dispose(): void {
        if (this.taskProvider) {
            this.taskProvider.dispose();
            this.taskProvider = undefined;
        }
        this.detectors.clear();
    }

    public async getTasks(): Promise<vscode.Task[]> {
        try {
            const tasks = await this.computeTasks();
            return tasks;
        } catch (err) {
            console.error(err);
            return [];
        }
    }

    private updateWorkspaceFolders(added: vscode.WorkspaceFolder[], removed: vscode.WorkspaceFolder[]): void {
        for (const remove of removed) {
            const detector = this.detectors.get(remove.uri.toString());
            if (detector) {
                detector.dispose();
                this.detectors.delete(remove.uri.toString());
            }
        }
        for (const add of added) {
            const detector = new FolderDetector(add);
            if (detector.isEnabled()) {
                this.detectors.set(add.uri.toString(), detector);
                detector.start();
            }
        }
        this.updateProvider();
    }

    private updateConfiguration(): void {
        for (const detector of this.detectors.values()) {
            if (!detector.isEnabled()) {
                detector.dispose();
                this.detectors.delete(detector.workspaceFolder.uri.toString());
            }
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
            for (const folder of folders) {
                if (!this.detectors.has(folder.uri.toString())) {
                    const detector = new FolderDetector(folder);
                    if (detector.isEnabled()) {
                        this.detectors.set(folder.uri.toString(), detector);
                        detector.start();
                    }
                }
            }
        }
        this.updateProvider();
    }

    private updateProvider(): void {
        if (!this.taskProvider && this.detectors.size > 0) {
            this.taskProvider = vscode.tasks.registerTaskProvider("zilf", {
                provideTasks: () => {
                    return this.getTasks();
                },
                resolveTask(_task: vscode.Task): vscode.Task | undefined {
                    return undefined;
                },
            });
        } else if (this.taskProvider && this.detectors.size === 0) {
            this.taskProvider.dispose();
            this.taskProvider = undefined;
        }
    }

    private async computeTasks(): Promise<vscode.Task[]> {
        switch (this.detectors.size) {
            case 0:
                return [];
            case 1:
                return this.detectors.values().next().value.getTasks();
            default:
                const promises: Array<Promise<vscode.Task[]>> = [];
                for (const detector of this.detectors.values()) {
                    promises.push(detector.getTasks().catch(() => []));
                }
                const values = await Promise.all(promises);
                return ([] as vscode.Task[]).concat(...values);
        }
    }
}

export async function getOutputPathWithoutExtension() {
    for (const ws of vscode.workspace.workspaceFolders || []) {
        const loc = computeMainFileLocation(ws);
        if (!loc.dir || !loc.filename) { continue; }
        const resolved = path.resolve(loc.dir, loc.filename);
        const parsed = path.parse(resolved);
        return path.join(parsed.dir, parsed.name);
    }

    throw new Error("no main file");
}

export async function getOutputZVersion() {
    for (const ws of vscode.workspace.workspaceFolders || []) {
        const loc = computeMainFileLocation(ws);
        if (!loc.dir || !loc.filename) { continue; }
        const mainFile = path.resolve(loc.dir, loc.filename);

        const doc = await vscode.workspace.openTextDocument(mainFile);
        const docText = doc.getText();

        const match = /<\s*VERSION\s+([EXY]?ZIP|0*[345678])\b>/i.exec(docText);
        if (!match) { continue; }

        switch (match[1].toUpperCase()) {
            case "ZIP": return 3;
            case "EZIP": return 4;
            case "XZIP": return 5;
            case "YZIP": return 6;
            default: return Number.parseInt(match[1], 10);
        }
    }

    // no promising <VERSION> directive
    return 3;
}

export async function getStoryFilePath() {
    const [outputBase, zversion] = await Promise.all([
        getOutputPathWithoutExtension(),
        getOutputZVersion(),
    ]);
    return `${outputBase}.z${zversion}`;
}

export async function getDebugFilePath() {
    const outputBase = await getOutputPathWithoutExtension();
    return `${outputBase}.dbg`;
}

export default function registerBuildTasks(context: vscode.ExtensionContext): vscode.Disposable[] {
    const detector = new TaskDetector();
    detector.start();

    return [
        detector,
        vscode.commands.registerCommand(
            "zil.debugger.getOutputPathWithoutExtension",
            getOutputPathWithoutExtension),
        vscode.commands.registerCommand(
            "zil.debugger.getOutputZVersion",
            getOutputZVersion),
        vscode.commands.registerCommand(
            "zil.debugger.getStoryFilePath",
            getStoryFilePath),
        vscode.commands.registerCommand(
            "zil.debugger.getDebugFilePath",
            getDebugFilePath),
    ];
}
