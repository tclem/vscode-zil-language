"use strict";

import * as vscode from "vscode";

import { HasRange } from "../../range";
import { Availability, FileScope, Lang, LanguageContext, Scope } from "../../scope";
import { ZilSymbolKind } from "../../symbols/zilsymbol";
import { Tidbits } from "../../workspace/workspace";
import SExpr from "../sexpr/sexpr";
import tokenize from "../tokens/tokenize";
import { Token, TokenKind } from "../tokens/tokens";
import BindDefinitionStudier from "./bind";
import GenericDefinitionStudier from "./generic";
import ObjectDefinitionStudier from "./object";
import RoutineDefinitionStudier from "./routine";
import { DefinitionInfo, DefinitionStudier } from "./types";

const DEFINITION_STUDIERS: DefinitionStudier[] = [
    new RoutineDefinitionStudier(["DEFINE", "DEFINE20"], ZilSymbolKind.Function, Availability.MDL),
    new RoutineDefinitionStudier(["DEFMAC"], ZilSymbolKind.Macro, Availability.BOTH),
    new RoutineDefinitionStudier(["ROUTINE"], ZilSymbolKind.Routine, Availability.ZCODE),

    new RoutineDefinitionStudier.Anonymous(["FUNCTION"], ZilSymbolKind.Function, Availability.MDL),

    new BindDefinitionStudier(["BIND", "PROG", "REPEAT"], ZilSymbolKind.BoundLocal, Availability.BOTH),

    new ObjectDefinitionStudier(["OBJECT"], ZilSymbolKind.Object, Availability.ZCODE),
    new ObjectDefinitionStudier(["ROOM"], ZilSymbolKind.Room, Availability.ZCODE),

    new GenericDefinitionStudier(
        ["COMPILATION-FLAG", "COMPILATION-FLAG-DEFAULT"], ZilSymbolKind.CompilationFlag, Availability.BOTH),
    new GenericDefinitionStudier(["CONSTANT"], ZilSymbolKind.Constant, Availability.BOTH),
    new GenericDefinitionStudier(["DEFAULT-DEFINITION"], ZilSymbolKind.DefinitionBlock, Availability.BOTH),
    new GenericDefinitionStudier(["GLOBAL"], ZilSymbolKind.Global, Availability.ZCODE),
    new GenericDefinitionStudier(["NEWTYPE"], ZilSymbolKind.NewType, Availability.MDL),
    new GenericDefinitionStudier(["PACKAGE", "DEFINITIONS"], ZilSymbolKind.Package, Availability.MDL),
    new GenericDefinitionStudier(["PROPDEF"], ZilSymbolKind.Property, Availability.BOTH),

    // these generic studiers still need to be expanded to capture child defs
    new GenericDefinitionStudier(["DEFSTRUCT"], ZilSymbolKind.DefStruct, Availability.BOTH),
    new GenericDefinitionStudier(["SYNTAX"], ZilSymbolKind.Action, Availability.ZCODE),

    // TODO: BIT-SYNONYM
    // TODO: word synonyms: SYNONYM, VERB-SYNONYM, etc.
];

const DEFINITION_STUDIER_MAP = new Map<string, DefinitionStudier>();
for (const s of DEFINITION_STUDIERS) {
    for (const definer of s.definingWords) {
        DEFINITION_STUDIER_MAP.set(definer, s);
    }
}

const ATOM_FINISHED_REGEX = /(?![^ \t-\r,#':;%()\[\]<>\{\}"])/;
const DEFINITION_REGEX = new RegExp(
    "(<\\s*)(" +
    Array.from(DEFINITION_STUDIER_MAP.keys()).join("|") +
    ")" + ATOM_FINISHED_REGEX.source,
    "gi");

// TODO: more sophisticated transition algorithm for definition forms...
// in <GLOBAL FOO <BAR>>, FOO is zcode but BAR is MDL; but in <GLOBAL <FOO> <BAR>>, FOO is MDL also
const LANG_TRANSITIONS = new Map<string, Lang>([
    // MDL definitions
    ["DEFINE", Lang.MDL],
    ["DEFINE20", Lang.MDL],    // XXX use MDL-ZIL?
    ["DEFMAC", Lang.MDL],
    ["FUNCTION", Lang.MDL],

    // Z-code definitions with MDL initializers
    ["CONSTANT", Lang.BOTH],
    ["GLOBAL", Lang.BOTH],
    ["OBJECT", Lang.BOTH],
    ["ROOM", Lang.BOTH],

    // Z-code definitions with no MDL components
    ["ADD-TELL-TOKENS", Lang.ZCODE],
    ["ROUTINE", Lang.ZCODE],
    ["SYNTAX", Lang.ZCODE],
    ["TELL-TOKENS", Lang.ZCODE],

    // ZILF library stuff
    ["HINT", Lang.ZCODE],
    ["PRONOUN", Lang.ZCODE],
    ["SCOPE-STAGE", Lang.ZCODE],
    ["TEST-CASE", Lang.ZCODE],
    ["TEST-GO", Lang.ZCODE],
    ["TEST-SETUP", Lang.ZCODE],
]);

export class DocumentAnalyzer {
    public readonly analyzedVersion: number;
    public readonly exprs: SExpr[];
    private tokens: Token[];

    constructor(public readonly doc: vscode.TextDocument, public readonly fileScope: FileScope) {
        this.analyzedVersion = doc.version;
        this.tokens = Array.from(tokenize(doc));
        this.exprs = Array.from(SExpr.parseMany(this.tokens));
    }

    public* findDefinitions(): IterableIterator<{ defInfo: DefinitionInfo, tidbits?: Partial<Tidbits> }> {
        let match: RegExpExecArray | null;
        const text = this.doc.getText();
        // tslint:disable-next-line:no-conditional-assignment
        while (match = DEFINITION_REGEX.exec(text)) {
            const context = this.findCallSiteContext(match.index);
            const defInfo = {
                definer: match[2],
                definerStart: match.index + match[1].length,
                form: context.callForm,
            };
            const studier = DEFINITION_STUDIER_MAP.get(defInfo.definer);
            try {
                yield {
                    defInfo,
                    tidbits: studier && studier.study(this, defInfo),
                };
            } catch (err) {
                console.log(err);
            }
        }
    }

    public findCallSiteContext(offset: number): CallSiteContext {
        let form: SExpr.Bracketed | undefined;
        let callLang = Lang.MDL;
        let argLang = Lang.MDL;
        let level = 0;

        for (const g of SExpr.drillInto(this.exprs, offset)) {
            if (g instanceof SExpr.Bracketed) {
                const opener = g.open.text;
                if (opener.endsWith("<")) {
                    level++;
                    form = g;

                    callLang = argLang;
                    let newLang: Lang | undefined;

                    if (opener === "<") {
                        const head = g.contents[0];
                        if (head instanceof SExpr.SingleToken && head.token.kind === TokenKind.Atom) {
                            const tval = LANG_TRANSITIONS.get(head.token.text);
                            if (tval !== undefined) {
                                // this defType only applies if the offset is after the first word:
                                //    <ROUTINE FOO FOO-ACT ("AUX" (X <GETB ...>)) .Z>,
                                // FOO, FOO-ACT, X, GETB, and Z are all Z-code symbols, but ROUTINE is MDL
                                if (offset >= head.range.end) { newLang = tval; }
                            }
                        }
                    } else {
                        newLang = LANG_TRANSITIONS.get(opener);
                    }

                    if (newLang !== undefined) {
                        argLang = newLang;
                    }
                }
            }
        }

        if (form) {
            const idx = HasRange.binarySearchIndex(form.contents, offset);
            const argIndex = idx < 0 ? -idx - 3 : Math.min(idx - 1, form.contents.length - 1);

            return {
                argIndex,
                argLanguageContext: { lang: argLang } as LanguageContext,
                atTopLevel: level < 2,
                callForm: form,
                callLanguageContext: { lang: callLang } as LanguageContext,
            };
        } else {
            return {
                atTopLevel: level < 2,
                callLanguageContext: { lang: callLang } as LanguageContext,
            };
        }
    }

    public findScope(offset: number): Scope {
        return this.fileScope.findInnerScope(offset);
    }
}

interface CallSiteContextBase {
    callLanguageContext: LanguageContext;
    callForm?: SExpr.Bracketed;
    argLanguageContext?: LanguageContext;
    argIndex?: number;
    atTopLevel: boolean;
}

interface CallSiteContextWithCall extends CallSiteContextBase {
    callForm: SExpr.Bracketed;
    argLanguageContext: LanguageContext;
    argIndex: number;
}

type CallSiteContext = CallSiteContextBase | CallSiteContextWithCall;
