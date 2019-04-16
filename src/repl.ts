"use strict";

import * as vscode from "vscode";

import { getZilfPath } from "./util";

export default function registerREPL(context: vscode.ExtensionContext): vscode.Disposable[] {
    const startREPLCommand = async () => {
        const { path } = await getZilfPath();
        if (path) {
            const terminal = vscode.window.createTerminal("ZIL", path);
            terminal.show();
            context.subscriptions.push(terminal);
        } else {
            vscode.window.showErrorMessage("ZILF not found, please set zil.compiler.path");
        }
    };

    return [vscode.commands.registerCommand("zil.startREPL", startREPLCommand)];
}
