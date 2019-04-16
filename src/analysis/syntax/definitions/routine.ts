"use strict";

import { LanguageContext } from "../../scope";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import { VSCode } from "../../workspace/vscode";
import { Tidbits } from "../../workspace/workspace";
import SExpr from "../sexpr/sexpr";
import { getDefinitionFormatter } from "../signatures/formatters";
import { parseFunctionSignature } from "../signatures/function";
import { LocalVariable, Section, Signature } from "../signatures/signature";
import GenericDefinitionStudier from "./generic";
import { DefinitionInfo, StudyContext } from "./types";

class RoutineDefinitionStudier extends GenericDefinitionStudier {
    public study(context: StudyContext, defInfo: DefinitionInfo): Partial<Tidbits> {
        const { name, location } = this.extractNameAndLocation(context, defInfo);
        const mainSymbol = location && new ZilSymbol(name, this.symbolKind, this.availability, location);
        const symbols = mainSymbol ? [mainSymbol] : [];

        if (!defInfo.form) { return { symbols }; }

        const signatures: Signature[] = [];
        const availability = this.availability;
        const scope = context.fileScope.addInnerScope(
            defInfo.form.range,
            { lang: this.availability.lang } as LanguageContext,
        );

        const { signature, locals, activation } = this.parseFunctionSignature(defInfo.form);

        const numParams = (signature && signature.params ? signature.params.length : 0);
        const numLocalSymbols = numParams + (locals ? locals.length : 0);

        if (signature) {
            signatures.push(signature);
            if (mainSymbol) {
                mainSymbol.snippet = getDefinitionFormatter().format(signature);
            }

            for (const p of signature.params) {
                const kind = p.isOptional ? ZilSymbolKind.OptionalLocal : ZilSymbolKind.RequiredLocal;
                const section = p.section === Section.Required ? "" : p.section + " ";
                addLocalSymbol(p, kind, section);
            }
        }

        if (locals) {
            for (const l of locals) {
                addLocalSymbol(l, ZilSymbolKind.AuxiliaryLocal, '"AUX" ');
            }
        }

        if (activation) {
            addLocalSymbol(activation, ZilSymbolKind.ActivationAtom, '"NAME" ');
        }

        return { symbols, signatures };

        function addLocalSymbol(l: LocalVariable, kind: ZilSymbolKind, snippetPrefix: string): void {
            const lvname = l.name;
            const nameWithDefault = l.defaultValue ? `(${lvname} ${l.defaultValue.toString()})` : lvname;
            const definition = l.nameToken && VSCode.rangeToLocation(l.nameToken.range, context.doc);
            scope.symbols.push(
                new ZilSymbol(lvname, kind, availability, definition, snippetPrefix + nameWithDefault, mainSymbol),
            );
        }
    }

    protected parseFunctionSignature(def: SExpr.Bracketed) {
        return parseFunctionSignature(def);
    }
}

namespace RoutineDefinitionStudier {
    export class Anonymous extends RoutineDefinitionStudier {
        protected extractNameAndLocation(context: StudyContext, defInfo: DefinitionInfo) {
            return { name: "" };
        }

        protected parseFunctionSignature(def: SExpr.Bracketed) {
            return parseFunctionSignature(def, true);
        }
    }
}

export default RoutineDefinitionStudier;
