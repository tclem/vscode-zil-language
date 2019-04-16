"use strict";

import {
    CancellationToken, Definition, DefinitionProvider, Disposable, DocumentSymbolProvider,
    ExtensionContext, languages, ParameterInformation, Position, ProviderResult, SignatureHelp,
    SignatureHelpProvider, SymbolInformation, TextDocument, WorkspaceSymbolProvider,
} from "vscode";

import { Range } from "../analysis/range";
import { getCallSiteFormatter } from "../analysis/syntax/signatures/formatters";
import { Signature } from "../analysis/syntax/signatures/signature";
import { VSCode } from "../analysis/workspace/vscode";
import { getWorkspace } from "../analysis/workspace/workspace";
import { ZIL_MODE } from "../util";

class SymbolProvider implements DocumentSymbolProvider, WorkspaceSymbolProvider, DefinitionProvider {
    public provideDocumentSymbols(
        document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[]> {

        return getWorkspace().getDocumentSymbols(document.uri)
            .filter((s) => s.hasDefinition())
            .map((s) => VSCode.symbolToSymbolInfo(s));
    }

    public provideWorkspaceSymbols(query: string, token: CancellationToken): ProviderResult<SymbolInformation[]> {
        return getWorkspace().getSymbols(query)
            .filter((s) => s.hasDefinition())
            .map((s) => VSCode.symbolToSymbolInfo(s));
    }

    public provideDefinition(
        document: TextDocument, position: Position,
        token: CancellationToken): ProviderResult<Definition> {

        // tslint:disable-next-line:prefer-const
        let { word, scope, symbols } = getWorkspace().getSymbolsAtPosition(document, position, { requireMatch: true });
        symbols = symbols.filter((s) => s.hasDefinition());

        console.log(
            `[symbols] definitions at ${position.line},${position.character}: ` +
            `word="${word.found ? word.text : ""}" ` +
            `symbols=[${symbols.map((s) => s.name).join()}]"`);

        switch (symbols.length) {
            case 0: return null;
            case 1: return symbols[0].definition;
            default: return symbols.map((s) => s.definition!);
        }
    }
}

export default function registerSymbolProvider(context: ExtensionContext): Disposable[] {
    const provider = new SymbolProvider();
    return [
        languages.registerDocumentSymbolProvider(ZIL_MODE, provider),
        languages.registerWorkspaceSymbolProvider(provider),
        languages.registerDefinitionProvider(ZIL_MODE, provider),
    ];
}
