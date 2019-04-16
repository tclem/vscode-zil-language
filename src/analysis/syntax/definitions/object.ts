"use strict";

import { ELLIPSIS } from "../../../util";
import { Availability } from "../../scope";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import { VSCode } from "../../workspace/vscode";
import { Tidbits } from "../../workspace/workspace";
import { ParsedBinding, SExprReader } from "../sexpr/reader";
import SExpr, { Atom, List } from "../sexpr/sexpr";
import { LocalVariable } from "../signatures/signature";
import { Token } from "../tokens/tokens";
import GenericDefinitionStudier from "./generic";
import { DefinitionInfo, StudyContext } from "./types";

export default class ObjectDefinitionStudier extends GenericDefinitionStudier {
    public study(context: StudyContext, defInfo: DefinitionInfo): Partial<Tidbits> {
        if (!defInfo.form) { return {}; }

        const outerBuf = new SExprReader(defInfo.form.contents);
        outerBuf.nextAtom();     // skip OBJECT/ROOM
        const nameToken = outerBuf.nextAtom();
        const weakSymbols: ZilSymbol[] = [];

        const mainSymbol = new ZilSymbol(
            nameToken.text,
            this.symbolKind,
            this.availability,
            VSCode.rangeToLocation(nameToken.range, context.doc),
        );

        let prop: SExpr | undefined;
        const propsForSnippet = new Map<string, string>();

        // tslint:disable-next-line:no-conditional-assignment
        while (!outerBuf.eof && (prop = outerBuf.next())) {
            let propName: string | undefined;
            try {
                if (!(prop instanceof List)) { continue; }
                const propBuf = new SExprReader(prop.contents);
                const propNameToken = propBuf.maybeNextAtom();
                if (!propNameToken) { continue; }

                propName = propNameToken.text.toUpperCase();
                const next = propBuf.peek();

                switch (propName) {
                    case "LOC":
                    case "DESC":
                        // skip pseudo-property
                        if (next) { propsForSnippet.set(propName, next.toString()); }
                        continue;

                    case "IN":
                        // (IN "foo") and (IN TO KITCHEN) are properties, but (IN KITCHEN) is a pseudo-property
                        if (prop.contents.length === 2 && prop.contents[1] instanceof Atom) {
                            if (next) { propsForSnippet.set("LOC", next.toString()); }
                            continue;
                        }
                        break;

                    case "FLAGS":
                        pushSymbolsForAtoms(
                            propBuf,
                            weakSymbols,
                            (atom) => makeLinkedSymbols(atom.token, ZilSymbolKind.Flag, Availability.ZCODE),
                        );
                        combineAtomsForSnippet(prop.contents, "FLAGS");
                        // skip pseudo-property
                        continue;

                    case "SYNONYM":
                        pushSymbolsForAtoms(
                            propBuf,
                            weakSymbols,
                            (atom) => makeLinkedSymbols(atom.token, ZilSymbolKind.VocabWord, Availability.ZCODE,
                                                        "W?"),
                            ([sym, wsym]) => {
                                sym.snippet = wsym.snippet = `(vocab word) ${sym.name}\n` +
                                    `<CONSTANT W?${sym.name} <VOC "${sym.name}" NOUN>>`;
                            },
                        );
                        combineAtomsForSnippet(prop.contents, "SYNONYM");
                        break;

                    case "ADJECTIVE":
                        pushSymbolsForAtoms(
                            propBuf,
                            weakSymbols,
                            // XXX A?WORD only exists in some Z-versions...
                            (atom) => makeLinkedSymbols(atom.token, ZilSymbolKind.VocabWord, Availability.ZCODE,
                                                        "W?", "A?"),
                            ([sym, wsym, asym]) => {
                                sym.snippet = wsym.snippet = asym.snippet = `(vocab word) ${sym.name}\n` +
                                    `<CONSTANT W?${sym.name} <VOC "${sym.name}" ADJ>>`;
                            },
                                                    );
                        combineAtomsForSnippet(prop.contents, "ADJECTIVE");
                        break;
                }

                const [propSym, propConstant] = makeLinkedSymbols(
                    propNameToken,
                    ZilSymbolKind.Property,
                    Availability.ZCODE,
                    "P?",
                );
                propSym.snippet = prop.toString();    // TODO: abbreviate
                propConstant.docString = `Property number for ${propName}.`;
                weakSymbols.push(propSym, propConstant);
            } catch (err) {
                const andProp = propName ? `, property '${propName}'` : "";
                console.log(`In object '${mainSymbol.name}'${andProp}: ${err}`);
            }
        }

        mainSymbol.snippet = generateSnippet();

        return { symbols: [mainSymbol], weakSymbols };

        function combineAtomsForSnippet(groups: SExpr[], propName: string): void {
            const buf = new SExprReader(groups);
            buf.maybeNextAtom();
            const parts = propsForSnippet.has(propName)
                ? propsForSnippet.get(propName)!.split(" ")
                : [];
            while (!buf.eof) {
                const next = buf.next();
                if (next && next instanceof Atom) { parts.push(next.token.text); }
            }
            propsForSnippet.set(propName, parts.sort().join(" "));
        }

        function generateSnippet(): string {
            let result = `<${defInfo.definer} ${nameToken.text}`;
            for (const key of ["DESC", "LOC", "SYNONYM", "ADJECTIVE", "FLAGS"]) {
                if (propsForSnippet.has(key)) {
                    result += `\n    (${key} ${propsForSnippet.get(key)})`;
                }
            }
            return result + " " + ELLIPSIS;
        }

        function pushSymbolsForAtoms(buf: SExprReader, dest: ZilSymbol[],
                                     makeSymbols: (atom: Atom) => ZilSymbol[],
                                     postProcess?: (syms: ZilSymbol[]) => void): void {
            while (!buf.eof) {
                const atom = buf.next();
                if (!atom || !(atom instanceof Atom)) { continue; }
                const syms = makeSymbols(atom);
                if (postProcess) { postProcess(syms); }
                dest.push(...syms);
            }
        }

        function makeLinkedSymbols(mainNameToken: Token, symbolKind: ZilSymbolKind, availability: Availability,
                                   ...prefixes: string[]): ZilSymbol[] {
            const mainLocation = VSCode.rangeToLocation(mainNameToken.range, context.doc);

            const results = [new ZilSymbol(
                mainNameToken.text,
                symbolKind,
                availability,
                mainLocation,
                mainNameToken.text,
            )];

            for (const prefix of prefixes) {
                const prefixedName = prefix + mainNameToken.text;
                results.push(new ZilSymbol(
                    prefixedName,
                    ZilSymbolKind.Constant,
                    Availability.BOTH,
                    mainLocation,
                    prefixedName,
                    results[0],
                ));
            }

            return results;
        }
    }
}
