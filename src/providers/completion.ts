"use strict";

import * as vscode from "vscode";

import { ZilSymbolKind } from "../analysis/symbols/zilsymbol";
import { VSCode } from "../analysis/workspace/vscode";
import { getWorkspace, SymbolMatch } from "../analysis/workspace/workspace";
import { getWordInContext, ZIL_MODE } from "../util";

const ZSK_SORT_MAP = new Map<ZilSymbolKind, string>([
    [ZilSymbolKind.BoundLocal, "a"],

    [ZilSymbolKind.AuxiliaryLocal, "b"],
    [ZilSymbolKind.OptionalLocal, "b"],
    [ZilSymbolKind.RequiredLocal, "b"],

    [ZilSymbolKind.Global, "c"],
    [ZilSymbolKind.Constant, "c"],

    [ZilSymbolKind.Object, "d"],
    [ZilSymbolKind.Room, "d"],
]);

class CompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken,
        context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

        const { word, symbols } = getWorkspace().getSymbolsAtPosition(
            document, position, { match: SymbolMatch.SUBSTRING });

        // tslint:disable-next-line:max-line-length
        console.log(
            `[completion] text="${word.found ? word.text : ""}" prefix="${word.prefix}" ` +
            `at ${position.line},${position.character}`);

        // TODO: filter duplicates (e.g. builtin SET)... maybe this belongs in symbols.ts?

        // TODO: context-sensitive sort/filter
        //   (e.g. SET wants local + anything, PUTP wants object + property constant + anything,
        //   comma prefix wants global, property clause wants property name, prefer stuff in the current file...)

        // TODO: better default sort?

        return symbols.map((s) => {
            const item = VSCode.symbolToCompletionItem(s);
            item.sortText = ZSK_SORT_MAP.get(s.kind) || "zzz";
            return item;
        });
    }
}

export default function registerCompletionProvider(context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.languages.registerCompletionItemProvider(ZIL_MODE, new CompletionProvider(), "<", ",", ".", "#"),
    ];
}
