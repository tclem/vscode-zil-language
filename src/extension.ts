/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Jesse McGrew. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for details.
 *  Based on extension samples released by Microsoft Corporation under the MIT License.
 *--------------------------------------------------------------------------------------------*/
"use strict";

import { Disposable, ExtensionContext } from "vscode";

import { isArray } from "util";
import { startWorkspace } from "./analysis/workspace/workspace";
import startBrackets from "./brackets";
import registerBuildTasks from "./providers/buildTasks";
import registerCompletionProvider from "./providers/completion";
import registerDebugConfigProvider from "./providers/debugConfig";
import registerHoverProvider from "./providers/hover";
import registerSignatureProvider from "./providers/signature";
import registerSymbolProvider from "./providers/symbol";
import registerREPL from "./repl";

type Initializer = (c: ExtensionContext) =>
    void | Disposable | Disposable[] | PromiseLike<void | Disposable | Disposable[]>;

export async function activate(context: ExtensionContext) {
    const initializers: Initializer[] = [
        registerBuildTasks,
        registerCompletionProvider,
        registerDebugConfigProvider,
        registerHoverProvider,
        registerREPL,
        registerSignatureProvider,
        registerSymbolProvider,
        startBrackets,
        startWorkspace,
    ];

    const results = await Promise.all(initializers.map((i) => Promise.resolve(i(context))));
    for (const r of results) {
        if (isArray(r)) {
            context.subscriptions.push(...r);
        } else if (r) {
            context.subscriptions.push(r);
        }
    }
}
