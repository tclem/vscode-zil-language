"use strict";

import * as vscode from "vscode";
import { Availability } from "../../scope";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import { Tidbits } from "../../workspace/workspace";
import { getCallSiteFormatter } from "./formatters";
import { Section, Signature, SignatureParam, Typable } from "./signature";

export interface BuiltinDump {
    [name: string]: BuiltinPattern[];
}

type BuiltinPattern = MdlPattern | ZcodePattern;

interface PatternBase {
    minArgs: number;
    maxArgs?: number;
    args: PatternPart[];
    returns?: PatternPart;
}

interface MdlPattern extends PatternBase {
    context: "mdl";
}

interface ZcodePattern extends PatternBase {
    context: "zcode";
    minVersion: number;
    maxVersion: number;
}

interface Or<T> {
    $or: Array<Combination<T>>;
}

function isOr<T>(part: Combination<T>): part is Or<T> {
    return !!(part as Or<T>).$or;
}

interface And<T> {
    $and: Array<Combination<T>>;
}

function isAnd<T>(part: Combination<T>): part is And<T> {
    return !!(part as And<T>).$and;
}

type Combination<T> = T | Or<T> | And<T>;

interface PatternPart extends Typable {
    name?: string;
    eval?: boolean;

    [key: string]: any;
}

interface OrPart extends PatternPart, Or<PatternPart> {}

interface AndPart extends PatternPart, And<PatternPart> {}

interface SeqPart extends PatternPart {
    $seq: PatternPart[];
}

function isSeq(part: PatternPart): part is SeqPart {
    return !!(part as SeqPart).$seq;
}

interface StructPart extends PatternPart {
    constraint: { constraint: "type", type: "FORM" | "LIST" | "ADECL" };
    elements: PatternPart[];
}

function isStruct(part: PatternPart): part is StructPart {
    return !!(part as StructPart).elements;
}

interface AdeclPart extends StructPart {
    constraint: { constraint: "type", type: "ADECL" };
    elements: [PatternPart, PatternPart];
}

function isAdecl(part: PatternPart): part is AdeclPart {
    return isStruct(part) && part.constraint.type === "ADECL";
}

interface LiteralPart extends PatternPart {
    literal: string;
}

function isLiteral(part: PatternPart): part is LiteralPart {
    return !!(part as LiteralPart).literal;
}

interface OptPart extends PatternPart {
    $opt: PatternPart;
}

function isOpt(part: PatternPart): part is OptPart {
    return !!(part as OptPart).$opt;
}

interface RestPart extends PatternPart {
    $rest: PatternPart;
    required: boolean;
}

function isRest(part: PatternPart): part is RestPart {
    return !!(part as RestPart).$rest;
}

function convertFlatPart(part: PatternPart): SignatureParam {
    let isOptional = false;

    if (isOpt(part)) {
        isOptional = true;
        part = part.$opt;
    }

    const name = part.name || "arg";
    const isEvaluated = part.eval !== false;
    const section = isOptional ? Section.OPT : Section.Required;
    const constraint = part.constraint;

    if (isStruct(part)) {
        return {
            constraint,
            isEvaluated,
            isOptional,
            isVarargs: false,
            name: `(${name})`,
            section,
        };
    } else if (isAdecl(part)) {
        return {
            constraint,
            isEvaluated,
            isOptional,
            isVarargs: false,
            name,
            section,
        };
    } else if (isLiteral(part)) {
        return {
            constraint: { constraint: "literal", value: part.literal },
            isEvaluated,
            isOptional,
            isVarargs: false,
            name: part.literal,
            section,
        };
    } else if (isOpt(part)) {
        throw new Error("shouldn't get here");
    } else if (isRest(part)) {
        return {
            constraint,
            isEvaluated,
            isOptional: !part.required,
            isVarargs: true,
            name: part.$rest.name || "rest",
            section: isEvaluated ? Section.TUPLE : Section.ARGS,
        };
    } else {
        return {
            constraint,
            isEvaluated,
            isOptional,
            isVarargs: false,
            name,
            section,
        };
    }
}

function flattenPart(part: PatternPart): PatternPart {
    const r: PatternPart = {} as any;
    for (const i in part) {
        if (i !== "$or" && i !== "$seq" && part.hasOwnProperty(i)) {
            r[i] = part[i];
        }
    }
    return r;
}

function* enumerateFlattenings(bpat: BuiltinPattern): IterableIterator<BuiltinPattern> {
    yield make(bpat.args.map(flattenPart));

    // TODO: more flattenings... needs some design

    function make(withArgs: PatternPart[]): BuiltinPattern {
        return {
            args: withArgs,
            context: bpat.context as any,
            maxArgs: bpat.maxArgs,
            maxVersion: bpat.context === "zcode" ? bpat.maxVersion : undefined,
            minArgs: bpat.minArgs,
            minVersion: bpat.context === "zcode" ? bpat.minVersion : undefined,
            returns: bpat.returns,
        };
    }
}

export function studyBuiltinPatterns(name: string, bpats: BuiltinPattern[]): Partial<Tidbits> {
    const symbols: ZilSymbol[] = [];
    const signatures: Signature[] = [];
    const symbol: Partial<Record<BuiltinPattern["context"], ZilSymbol>> = {};
    const alreadySeen = new Set<string>();

    for (const bpat of bpats) {
        let availability: Availability;
        if (bpat.context === "mdl") {
            availability = Availability.MDL;
            // TODO: indicate subr vs. fsubr
        } else {
            availability = Availability.ZCODE;
            // TODO: include min/max version
        }

        for (const fpat of enumerateFlattenings(bpat)) {
            const sig = {
                availability,
                maxArgCount: fpat.maxArgs,
                minArgCount: fpat.minArgs,
                name,
                params: fpat.args.map(convertFlatPart),
                symbol: undefined as ZilSymbol | undefined,
            };

            // don't add two signatures with the same snippet
            const snippet = getCallSiteFormatter().format(sig);
            if (alreadySeen.has(snippet)) { continue; }
            alreadySeen.add(snippet);

            if (!symbol[bpat.context]) {
                const sym = symbol[bpat.context] = new ZilSymbol(
                    name,
                    bpat.context === "mdl" ? ZilSymbolKind.Subr : ZilSymbolKind.ZBuiltin,
                    availability,
                    undefined,
                    snippet,
                );
                symbols.push(sym);
            }

            sig.symbol = symbol[bpat.context];
            signatures.push(sig);
        }
    }

    return { signatures, symbols };
}
