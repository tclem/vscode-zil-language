"use strict";

import * as vscode from "vscode";

import { Availability } from "../../scope";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import { VSCode } from "../../workspace/vscode";
import { Tidbits } from "../../workspace/workspace";
import { DefinitionInfo, DefinitionStudier, StudyContext } from "./types";

export default class GenericDefinitionStudier implements DefinitionStudier {
    constructor(
        public readonly definingWords: string[],
        protected symbolKind: ZilSymbolKind,
        protected availability: Availability) { }

    public study(context: StudyContext, defInfo: DefinitionInfo): Partial<Tidbits> {
        return { symbols: [this.extractMainSymbol(context, defInfo)] };
    }

    protected extractMainSymbol(context: StudyContext, defInfo: DefinitionInfo): ZilSymbol {
        const snippet = this.extractSnippet(context, defInfo);
        const { name, location } = this.extractNameAndLocation(context, defInfo);
        return new ZilSymbol(name, this.symbolKind, this.availability, location, snippet);
    }

    protected extractSnippet(context: StudyContext, defInfo: DefinitionInfo) {
        if (!defInfo.form) {
            // use the whole line as the snippet
            return context.doc.lineAt(context.doc.positionAt(defInfo.definerStart)).text;
        }

        // use the whole form as the snippet
        const vsrange = VSCode.rangeToLocation(defInfo.form.range, context.doc).range;
        return context.doc.getText(vsrange);
    }

    protected extractNameAndLocation(context: StudyContext, defInfo: DefinitionInfo) {
        if (!defInfo.form) {
            return { name: "?" } as { name: string, location?: vscode.Location };
        }

        // extract the name and its location, stripping quotes if present
        const name = defInfo.form.contents[1].toString();
        const range = defInfo.form.range;
        const location = VSCode.rangeToLocation(range, context.doc);
        return { name, location };
    }
}
