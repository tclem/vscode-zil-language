"use strict";

import { HasRange, Range } from "../../range";

export class Token<TKind extends TokenKind = TokenKind> implements HasRange {
    public leadingTrivia: Trivium[] = [];
    public trailingTrivia: Trivium[] = [];

    constructor(public readonly kind: TKind, public readonly text: string, public readonly range: Range) {}

    public toString() {
        return `'${this.text.replace("'", "\\'")}'`;
    }

    public enforce<Tk extends TKind>(kind: Tk): Token<Tk> {
        if (this.kind === kind) { return this as any; }
        throw new Error(`expected token kind ${kind} but got ${this.kind}`);
    }
}

export enum TokenKind {
    Illegal,

    Space,

    Open,
    Close,
    Prefix,

    Atom,
    Character,
    Decimal,
    Octal,
    String,
}

export interface Trivium {
    kind: TriviaKind;
    text: string;
    range: Range;
}

export enum TriviaKind {
    WhiteSpace,
    Comment,
}
