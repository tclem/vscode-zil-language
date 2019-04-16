"use strict";

import * as vscode from "vscode";

import { FileScope } from "../../scope";
import { Tidbits } from "../../workspace/workspace";
import SExpr from "../sexpr/sexpr";

export interface DefinitionStudier {
    readonly definingWords: string[];
    study(context: StudyContext, defInfo: DefinitionInfo): Partial<Tidbits>;
}

export interface DefinitionInfo {
    definer: string;
    definerStart: number;
    form?: SExpr.Bracketed;
}

export interface StudyContext {
    readonly doc: vscode.TextDocument;
    readonly exprs: SExpr[];
    readonly fileScope: FileScope;
}
