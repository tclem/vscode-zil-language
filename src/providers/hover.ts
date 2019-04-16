"use strict";

import * as path from "path";
import * as vscode from "vscode";

import { ZilSymbolKind } from "../analysis/symbols/zilsymbol";
import { getWorkspace } from "../analysis/workspace/workspace";
import { getWordInContext, ZIL_MODE } from "../util";

class HoverProvider implements vscode.HoverProvider {
    public async provideHover(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Promise<vscode.Hover | null> {

        const result = getWorkspace().getSymbolsAtPosition(document, position, { requireMatch: true });
        if (!result.word) { return null; }

        if (result.symbols.length) {
            const symbols = result.symbols
                .sort((a, b) => a.snippet.localeCompare(b.snippet))
                .filter((sym, i, arr) =>
                    i === 0 ||
                    sym.kind !== arr[i - 1].kind ||
                    sym.snippet !== arr[i - 1].snippet ||
                    sym.docString !== arr[i - 1].docString);
            const markdown = new vscode.MarkdownString();

            symbols.forEach((def, i) => {
                markdown.appendCodeblock(def.snippet, "zil");

                if (i === symbols.length - 1 || symbols[i + 1].kind !== def.kind) {
                    markdown.appendMarkdown("*");
                    markdown.appendText(ZilSymbolKind.getFriendlyName(def.kind));
                    markdown.appendMarkdown("*\n");

                    if (def.docString) {
                        markdown.appendText("\n");
                        markdown.appendText(def.docString);
                    }

                    if (i < symbols.length - 1) {
                        markdown.appendMarkdown("\n---\n\n");
                    }
                }
            });

            return new vscode.Hover(markdown, result.word.range);
        }

        return null;
    }
}

export default function registerHoverProvider(context: vscode.ExtensionContext): vscode.Disposable[] {
    return [vscode.languages.registerHoverProvider(ZIL_MODE, new HoverProvider())];
}
