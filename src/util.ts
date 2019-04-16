"use strict";

import * as cp from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";

export const ZIL_MODE: vscode.DocumentFilter = { language: "zil", scheme: "file" };

/**
 * We replace "..." with a Unicode ellipsis in builtin doc strings, because "..." is illegal ZIL
 * syntax and breaks highlighting.
 */
export const ELLIPSIS = "\u2026";

/** Zero-width space. */
export const ZWS = "\u200b";

const WORD_REGEXP: RegExp =
    /"(?:\\.|[^"])*"|(?:\\.|[^!\. \t-\r,#\':;%\(\)\[\]<>\{\}"])(?:\\.|[^ \t-\r,#\':;%\(\)\[\]<>\{\}"])*/;

export interface WordInContextSuccess {
    readonly found: true;
    readonly prefix: string;
    readonly text: string;
    readonly range: vscode.Range;
}

export interface WordInContextFailure {
    readonly found: false;
    readonly prefix: string;
    readonly text?: undefined;
    readonly range?: undefined;
}

export type WordInContext = WordInContextFailure | WordInContextSuccess;

export function getWordInContext(document: vscode.TextDocument, position: vscode.Position): WordInContext {
    const range: vscode.Range | undefined = document.getWordRangeAtPosition(position, WORD_REGEXP);
    if (!range || range.isEmpty) {
        const prefix: string = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));
        return { found: false, prefix };
    } else {
        const text: string = document.getText(range);

        // TODO: use prefix to deduce context in a more useful way
        const prefix = document.getText(
            new vscode.Range(new vscode.Position(range.start.line, 0), range.start));

        return { found: true, text, range, prefix };
    }
}

export function getConfig(folder?: vscode.WorkspaceFolder | null): vscode.WorkspaceConfiguration {
    // a warning message says the second parameter needs to be null instead of undefined, since we're potentially
    // asking for a resource-scoped config value without a resource URI, but the method signature doesn't allow it.
    // this bang dealy seems to get the point across.
    return vscode.workspace.getConfiguration("zil", (folder && folder.uri)!);
}

function uniqueItems<T>(array: T[]): T[] {
    const result: T[] = [];
    const seen = new Set();
    for (const item of array) {
        if (!seen.has(item)) {
            result.push(item);
            seen.add(item);
        }
    }
    return result;
}

// TODO: cache the ZILF path when starting or when the workspace changes, instead of checking each time
export async function getZilfPath(
    pickAny?: boolean): Promise<{ path: string | undefined, folder?: vscode.WorkspaceFolder }> {

    const folders = vscode.workspace.workspaceFolders;
    const configKey: string = "compiler.path";

    function zilfPathFromFolder(f: vscode.WorkspaceFolder | null): string | undefined {
        return getConfig(f).get<string>(configKey);
    }

    const globalPath = zilfPathFromFolder(null);
    const paths: string[] = Array.isArray(folders)
        ? uniqueItems(folders.map(zilfPathFromFolder).filter(Boolean)) as string[]
        : [];

    if (paths.length === 0) {
        if (globalPath) { return { path: globalPath }; }

        const SELECT_FILE = "Select File";
        const OPEN_SETTINGS = "Open Settings";

        const choice = await vscode.window.showWarningMessage(
            "Unable to locate ZILF, please correct zil.compiler.path setting", SELECT_FILE, OPEN_SETTINGS);

        if (choice === SELECT_FILE) {
            const path = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    ".NET executables": ["exe"],
                    "Scripts": ["sh", "bat", "cmd", "ps1"],
                },
            });
            if (path) {
                const fsPath = path[0].fsPath;
                await getConfig(null).update(configKey, fsPath, ConfigurationTarget.Global);
                return { path: fsPath };
            }
        } else if (choice === OPEN_SETTINGS) {
            await vscode.commands.executeCommand("workbench.action.openGlobalSettings");
        }
        return { path: globalPath /* which we know is undefined here */ };
    } else if (paths.length === 1 || pickAny) {
        if (paths.length > 1) {
            vscode.window.showInformationMessage(`Using ZILF config from ${paths[0]}`);
        }
        return { path: paths[0], folder: folders!.find((f) => zilfPathFromFolder(f) === paths[0]) };
    } else {
        const folder = await vscode.window.showWorkspaceFolderPick(
            { placeHolder: "Select a workspace to use its ZILF config" });
        return vscode.workspace && folder
            ? { path: zilfPathFromFolder(folder), folder }
            : { path: globalPath };
    }
}

function buildCommandLine(...params: string[]): string {
    return params.map((p) => {
        p = p.replace(/[\r\n]\s*/g, " ").replace(/"/g, '\\"');
        if (p.includes(" ")) {
            p = `"${p}"`;
        }
        return p;
    }).join(" ");
}

function exec(command: string): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
        cp.exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve([stdout, stderr]);
            }
        });
    });
}

export async function evalWithZilf(
    expr: string, pickAny?: boolean): Promise<{ stdout: string, folder?: vscode.WorkspaceFolder }> {

    const { path, folder } = await getZilfPath(pickAny);
    if (!path) {
        throw new Error("No ZILF path");
    }
    const cmd = buildCommandLine(path, "-e", expr);
    try {
        console.log(`executing ${cmd}`);
        const [stdout, _stderr] = await exec(cmd);
        return { stdout, folder };
    } catch (ex) {
        console.log(ex.toString());
        throw ex;
    }
}

export function assertNever(x: never): never {
    throw new Error();  // shouldn't get here
}

/**
 * Finds the index of an object in a sorted array, using a comparison function.
 * @param items A sorted array.
 * @param key A value to use to find the object.
 * @param compare A function that accepts an item and the original key, and returns &lt;0 if the key comes before the
 *                item, &gt;0 if it comes after, and 0 if it matches.
 * @returns The index of the item for which compare() returned 0, or if no match, the one's complement of the
 *          index where the item could be inserted (-i - 1).
 */
export function binarySearch<TItem, TKey>(
    items: TItem[], key: TKey, compare: (item: TItem, key: TKey) => number): number {

    let start = 0;
    let end = items.length - 1;
    while (start <= end) {
        const i = Math.floor((start + end) / 2);
        const c = compare(items[i], key);
        if (!c) { return i; }
        if (c < 0) { end = i - 1; } else { start = i + 1; }
    }
    return -start - 1;
}
