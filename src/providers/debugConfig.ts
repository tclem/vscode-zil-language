"use strict";

import * as JSONC from "jsonc-parser";
import * as path from "path";
import { isArray } from "util";
import * as vscode from "vscode";

import { LaunchRequestArguments } from "../debugger/zilDebug";
import { exists, readFile } from "../shared/async/fs";
import { getBuildTaskLabel, TASK_SOURCE_NAME } from "../shared/tasks";
import { getConfig } from "../util";
import {
    computeBuildTasks, getDebugFilePath, getStoryFilePath, isTaskDefinition, isZilTaskDefinition,
} from "./buildTasks";

class ZilDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    // TODO: debug configuration snippet provider? see https://github.com/Microsoft/vscode-cpptools/pull/1401/files

    private readonly defaultConfig: vscode.DebugConfiguration & LaunchRequestArguments = {
        console: "externalTerminal",
        name: "ZIL Game",
        request: "launch",
        type: "zmachine",
    };

    constructor(private context: vscode.ExtensionContext) { }

    public async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined,
                                            token?: vscode.CancellationToken) {
        const defaultConfig = Object.assign({}, this.defaultConfig);
        return [defaultConfig];
    }

    public async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, cfg: vscode.DebugConfiguration,
                                           token?: vscode.CancellationToken) {
        if (!cfg.name && !cfg.request && !cfg.type) {
            Object.assign(cfg, this.defaultConfig);
        }
        if (isZlrDebugConfig(cfg)) {
            const localConfig = getConfig(folder);
            if (!cfg.interpreter) {
                let interpreter = localConfig.get<string>("debugger.path");
                if (!interpreter || !await exists(interpreter)) {
                    interpreter = this.getPrepackagedInterpreter();
                }
                if (!interpreter || !await exists(interpreter)) {
                    await vscode.window.showErrorMessage(
                        "Check configuration: 'zil.debugger.path' is unset or the target does not exist.",
                        { modal: true });
                    return undefined;   // abort
                }
                cfg.interpreter = interpreter;
            }
            if (!cfg.storyFile) {
                try {
                    cfg.storyFile = await getStoryFilePath();
                } catch (err) {
                    await vscode.window.showErrorMessage(`Cannot locate story file: ${err}.`, { modal: true });
                    return undefined;
                }
            }
            if (!cfg.debugFile) {
                cfg.debugFile = await getDebugFilePath();
            }
            if (!cfg.preLaunchTask) {
                cfg.preLaunchTask = await findDebugBuildTaskName(folder, cfg.storyFile);
            }
            if ((!cfg.console || cfg.console === "integratedTerminal") && !cfg.internalConsoleOptions) {
                cfg.internalConsoleOptions = "neverOpen";
            }
        }

        return cfg;
    }

    private getPrepackagedInterpreter() {
        return this.context.asAbsolutePath("data/zlr/ConsoleZLR.exe");
    }
}

function isZlrDebugConfig(cfg: vscode.DebugConfiguration): cfg is LaunchRequestArguments & vscode.DebugConfiguration {
    return cfg.type === "zmachine";
}

function stem(file: string) {
    return path.parse(file).name;
}

async function findDebugBuildTaskName(folder: vscode.WorkspaceFolder | undefined, storyFile: string) {
    // TODO: read workspace folder config instead of tasks.json (see docs for vscode.WorkspaceConfiguration)
    if (!folder) { return; }
    if (folder.uri.scheme !== "file") {
        throw new Error("Expected file:// workspace");
    }
    const storyFileStem = stem(storyFile);
    const tasksFile = path.join(folder.uri.fsPath, ".vscode", "tasks.json");
    return findMatchingTask(await getTaskDefsFromFile(tasksFile))
        || findMatchingTask((await computeBuildTasks(folder)).map((t) => t.definition));

    function findMatchingTask(tasks: vscode.TaskDefinition[]) {
        for (const t of tasks) {
            if (isZilTaskDefinition(t) && t.type === "zilf+zapf" && t.build === "debug" &&
                (stem(t.file) === storyFileStem || /^\$\{[^}]*\}$/.test(storyFile))) {

                return t.identifier || t.taskName || t.label
                    || `${TASK_SOURCE_NAME}: ${getBuildTaskLabel(t.file, t.build)}`;
            }
        }
    }
}

async function getTaskDefsFromFile(file: string) {
    try {
        const taskFileContents = await readFile(file, "utf8");
        const taskFileTasks = JSONC.parse(taskFileContents);
        const candidates = taskFileTasks.tasks;
        if (isArray(candidates)) {
            return candidates.filter(isTaskDefinition);
        }
    } catch {
        // nada
    }
    return [];
}

export default function registerDebugConfigProvider(context: vscode.ExtensionContext) {
    const provider = new ZilDebugConfigurationProvider(context);
    return [
        vscode.debug.registerDebugConfigurationProvider("zmachine", provider),
    ];
}
