"use strict";

import { ELLIPSIS } from "../../../util";
import { Availability } from "../../scope";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import { VSCode } from "../../workspace/vscode";
import { Tidbits } from "../../workspace/workspace";
import { ParsedBinding, SExprReader } from "../sexpr/reader";
import { LocalVariable } from "../signatures/signature";
import GenericDefinitionStudier from "./generic";
import { DefinitionInfo, StudyContext } from "./types";

export default class BindDefinitionStudier extends GenericDefinitionStudier {
    public study(context: StudyContext, defInfo: DefinitionInfo): Partial<Tidbits> {
        if (!defInfo.form) { return {}; }

        const scope = context.fileScope.addInnerScope(defInfo.form.range);
        const locals: LocalVariable[] = [];

        const outerBuf = new SExprReader(defInfo.form.contents);
        outerBuf.nextAtom();    // skip BIND/REPEAT/PROG
        const activationAtom = outerBuf.maybeNextAtom();
        const bindings = outerBuf.maybeNextList();

        if (activationAtom) {
            scope.symbols.push(new ZilSymbol(
                activationAtom.text,
                ZilSymbolKind.ActivationAtom,
                Availability.from(scope.languageContext),
                VSCode.rangeToLocation(activationAtom.range, context.doc),
                `<${defInfo.definer} ${activationAtom.text} ${ELLIPSIS}>`,
            ));
        }

        if (bindings) {
            const innerBuf = new SExprReader(bindings.contents);
            let pb: ParsedBinding | undefined;
            // tslint:disable-next-line:no-conditional-assignment
            while (!innerBuf.eof && (pb = innerBuf.maybeNextParsedBinding())) {
                scope.symbols.push(new ZilSymbol(
                    pb.atom.text,
                    ZilSymbolKind.BoundLocal,
                    Availability.from(scope.languageContext),
                    VSCode.rangeToLocation(pb.atom.range, context.doc),
                    pb.group.toString(),
                ));
            }
        }

        return { scope };
    }
}
