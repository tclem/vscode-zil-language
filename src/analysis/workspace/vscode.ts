"use strict";

import * as vscode from "vscode";

import { Range } from "../range";
import { ZilSymbol, ZilSymbolKind } from "../symbols/zilsymbol";

export class VSCode {
    public static rangeToLocation(range: Range, doc: vscode.TextDocument): vscode.Location {
        return new vscode.Location(
            doc.uri,
            new vscode.Range(doc.positionAt(range.start), doc.positionAt(range.end)));
    }

    public static symbolToSymbolInfo(sym: ZilSymbol): vscode.SymbolInformation {
        if (!sym.hasDefinition()) {
            throw new Error(`Symbol ${sym.name} has no definition`);
        }
        return new vscode.SymbolInformation(
            sym.name,
            ZilSymbolKind.toSymbolKind(sym.kind),
            sym.parent ? sym.parent.name : "",
            sym.definition);
    }

    public static symbolToCompletionItem(sym: ZilSymbol): vscode.CompletionItem {
        const sk = ZilSymbolKind.toSymbolKind(sym.kind);
        const cik = vscode.CompletionItemKind[vscode.SymbolKind[sk] as keyof typeof vscode.CompletionItemKind];
        const result = new vscode.CompletionItem(sym.name, cik);
        result.detail = ZilSymbolKind.getFriendlyName(sym.kind);
        if (sym.snippet) {
            result.documentation = new vscode.MarkdownString().appendCodeblock(sym.snippet, "zil");
        }
        result.commitCharacters = [" ", "<", ">", "[", "]", "(", ")", "{", "}", ":", ";", "!"];
        return result;
    }
}
