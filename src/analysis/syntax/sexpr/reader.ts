"use strict";

import { Token, TokenKind } from "../tokens/tokens";
import Buffer from "./buffer";
import SExpr, { Atom, List, Quotation, ZString } from "./sexpr";

export class SExprReader extends Buffer<SExpr> {
    public maybeNextAtom(): Token<TokenKind.Atom> | undefined {
        const result = this.maybeNext((s): s is Atom => s instanceof Atom);
        return result && result.token;
    }

    public nextAtom(): Token<TokenKind.Atom> {
        return insist(this.maybeNextAtom(), "atom");
    }

    public maybeNextParsedBinding(): ParsedBinding | undefined {
        const result = this.maybeNext(isBinding);
        return result ? parseBinding(result) : undefined;
    }

    public maybeNextList(): List | undefined {
        return this.maybeNext((s): s is List => s instanceof List);
    }

    public nextList(): List {
        return insist(this.maybeNextList(), "list");
    }
}

export type QuotedAtom = Quotation & { prefix: { text: "'" }, inner: Atom };
export type TwoList = List & { contents: [Atom | QuotedAtom, SExpr] };
export type Binding = Atom | QuotedAtom | TwoList;

export function isQuotedAtom(group: SExpr): group is QuotedAtom {
    return group instanceof Quotation && group.inner instanceof Atom;
}

export function isTwoList(group: SExpr): group is TwoList {
    return group instanceof List && group.contents.length === 2;
}

export function isBinding(group: SExpr): group is Binding {
    return group instanceof Atom || isQuotedAtom(group) || isTwoList(group);
}

export interface ParsedBinding {
    atom: Token & { kind: TokenKind.Atom };
    group: SExpr;
    quoted?: boolean;
    defaultValue?: SExpr;
}

export function parseBinding(group: Binding): ParsedBinding {
    if (isTwoList(group)) {
        const [name, defaultValue] = group.contents;
        return isQuotedAtom(name)
            ? { atom: name.inner.token, quoted: true, defaultValue, group }
            : { atom: name.token, defaultValue, group };
    }
    if (isQuotedAtom(group)) {
        return { atom: group.inner.token, quoted: true, group };
    }
    return { atom: group.token, group };
}

function insist<T>(group: T | undefined, description: string): T {
    if (typeof group === "undefined") {
        throw new Error(`expected ${description}`);
    }
    return group;
}
