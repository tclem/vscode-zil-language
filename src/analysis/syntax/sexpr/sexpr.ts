"use strict";

import { isArray } from "util";
import { HasRange, Range } from "../../range";
import { Token, TokenKind } from "../tokens/tokens";

abstract class SExpr implements HasRange {
    public static *drillInto(exprs: SExpr[], targetOffset: number): IterableIterator<SExpr> {
        let group = HasRange.binarySearch(exprs, targetOffset);
        if (!group) { return; }
        yield group;

        while (group instanceof SExpr.Prefixed) {
            group = group.inner;
            yield group;
        }

        if (group instanceof SExpr.Bracketed) {
            yield* SExpr.drillInto(group.contents, targetOffset);
        }
    }

    public static *parseMany(
        tokens: IterableIterator<Token> | Token[],
        options?: SExpr.ParseOptions): IterableIterator<SExpr> {

        const tokenIter = isArray(tokens) ? tokens[Symbol.iterator]() : tokens;
        options = options || {};
        const observer = options.observer || NULL_OBSERVER;

        let expr: SExpr | undefined;
        // tslint:disable-next-line:no-conditional-assignment
        while (expr = nextExpr()) {
            if (expr instanceof SExpr.Prefixed && expr.prefix.text === ";" && !options.keepComments) {
                continue;
            }
            yield expr;
        }

        function nextToken(): Token | undefined {
            let done: boolean;
            let token: Token;
            do {
                ({ done, value: token } = tokenIter.next());
            } while (!done && token.kind === TokenKind.Space);
            return done ? undefined : token;
        }

        function nextExpr(): SExpr | undefined {
            const token = nextToken();
            if (!token) { return; }
            switch (token.kind) {
                case TokenKind.Open: {
                        const contents: SExpr[] = [];
                        const open = token.enforce(token.kind);
                        let close: Token<TokenKind.Close> | undefined;
                        observer.onBracketedExprStart(open);

                        const entry = BRACKET_MATCH.get(open.text);
                        if (!entry) { throw new Error(`unmatchable bracket "${open.text}"`); }
                        const { closeRX, ctor } = entry;

                        // group recursively until we find the matching close bracket or EOF
                        for (const g of SExpr.parseMany(tokenIter)) {
                            if (g instanceof SExpr.SingleToken && g.token.kind === TokenKind.Close &&
                                closeRX.test(g.token.text)) {

                                close = g.token.enforce(g.token.kind);
                                break;
                            }
                            observer.onBracketedExprElement(g, contents, open);
                            contents.push(g);
                        }
                        const result = new ctor(open, contents, close);
                        observer.onBracketedExprEnd(result);
                        return result;
                    }

                case TokenKind.Prefix: {
                    const inner = nextExpr();
                    if (!inner) { return new ParseError(token); }
                    const entry = PREFIX_MATCH.get(token.text);
                    if (!entry) { throw new Error(`unmatchable prefix "${token.text}"`); }
                    const { ctor } = entry;
                    return new ctor(token.enforce(token.kind), inner);
                }

                default:
                    {
                        const entry = SINGLE_TOKEN_MATCH.get(token.kind);
                        if (!entry) {
                            throw new Error(`unmatchable single token kind "${TokenKind[token.kind]}" (${token.kind})`);
                        }
                        const { ctor } = entry;
                        return new ctor(token);
                    }
            }
        }
    }

    protected static getStringParts(expr: SExpr) {
        return expr.toStringParts();
    }

    public abstract range: Range;

    public toString() {
        return Array.from(this.toStringParts()).join("");
    }

    protected abstract toStringParts(): IterableIterator<string>;
}

namespace SExpr {
    export abstract class Bracketed extends SExpr {
        constructor(public readonly open: Token<TokenKind.Open>,
                    public readonly contents: SExpr[],
                    public readonly close?: Token<TokenKind.Close>) {
            super();
        }

        public get range() {
            return HasRange.unionRanges(this.open, this.contents, this.close);
        }

        protected *toStringParts() {
            yield this.open.text;
            for (let i = 0; i < this.contents.length; i++) {
                if (i > 0) { yield " "; }
                yield* SExpr.getStringParts(this.contents[i]);
            }
            if (this.close) {
                if (this.close.text.startsWith("!")) {
                    yield " ";
                }
                yield this.close.text;
            }
        }
    }

    export abstract class Prefixed extends SExpr {
        constructor(public readonly prefix: Token<TokenKind.Prefix>,
                    public readonly inner: SExpr) {
            super();
        }

        public get range() {
            return HasRange.unionRanges(this.prefix, this.inner);
        }

        protected *toStringParts() {
            yield this.prefix.text;
            yield* SExpr.getStringParts(this.inner);
        }
    }

    export abstract class SingleToken extends SExpr {
        constructor(public readonly token: Token) { super(); }

        public get range() { return this.token.range; }

        protected *toStringParts() {
            yield this.token.text;
        }
    }

    export interface ParseOptions {
        keepComments?: boolean;
        observer?: ParseObserver;
    }

    export interface ParseObserver {
        onBracketedExprStart(open: Token): void;
        onBracketedExprElement(element: SExpr, prevContents: ReadonlyArray<SExpr>, open: Token): void;
        onBracketedExprEnd(group: Bracketed): void;
    }
}

const NULL_OBSERVER: SExpr.ParseObserver = {
    onBracketedExprStart() { return; },
    onBracketedExprElement() { return; },
    onBracketedExprEnd() { return; },
};

export default SExpr;

export class List extends SExpr.Bracketed { }
export class Vector extends SExpr.Bracketed { }
export class UVector extends SExpr.Bracketed { }
export class Form extends SExpr.Bracketed { }
export class Segment extends SExpr.Bracketed { }
export class Template extends SExpr.Bracketed { }

interface BracketMatchEntry {
    closeRX: RegExp;
    ctor: BracketedCtor;
}

type BracketedCtor =
    new (open: Token<TokenKind.Open>, contents: SExpr[], close?: Token<TokenKind.Close>) => SExpr.Bracketed;

const BRACKET_MATCH = new Map<string, BracketMatchEntry>([
    ["(", { closeRX: /!?\)/, ctor: List } ],
    ["[", { closeRX: /!?\]/, ctor: Vector }],
    ["<", { closeRX: /!?\>/, ctor: Form }],
    ["{", { closeRX: /!?\}/, ctor: Template }],
    ["!(", { closeRX: /!?\)/, ctor: List }],
    ["![", { closeRX: /!?\]/, ctor: UVector }],
    ["!<", { closeRX: /!?\>/, ctor: Segment }],
    ["!{", { closeRX: /!?\}/, ctor: Template }],
]);

// -------------------------------------------------------------------

type PrefixToken<TText extends string> = Token<TokenKind.Prefix> & { text: TText };

export class Comment extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<";">;
}
export class HashPrefix extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<"#">;
}
export class LVal extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<".">;
}
export class GVal extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<",">;
}
export class Quotation extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<"'">;
}

export abstract class AbstractReaderMacro extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<"%" | "%%">;
}
export class ReaderMacro extends AbstractReaderMacro {
    public readonly prefix!: PrefixToken<"%">;
}
export class VoidReaderMacro extends AbstractReaderMacro {
    public readonly prefix!: PrefixToken<"%%">;
}

export abstract class AbstractSegment extends SExpr.Prefixed {
    public readonly prefix!: PrefixToken<"!." | "!," | "!'">;
}
export class SegmentLVal extends AbstractSegment {
    public readonly prefix!: PrefixToken<"!.">;
}
export class SegmentGVal extends AbstractSegment {
    public readonly prefix!: PrefixToken<"!,">;
}
export class SegmentQuotation extends AbstractSegment {
    public readonly prefix!: PrefixToken<"!'">;
}

interface PrefixMatchEntry {
    ctor: PrefixedCtor;
}

type PrefixedCtor = new (prefix: Token<TokenKind.Prefix>, inner: SExpr) => SExpr.Prefixed;

const PREFIX_MATCH = new Map<string, PrefixMatchEntry>([
    [";", { ctor: Comment }],
    ["#", { ctor: HashPrefix }],
    [".", { ctor: LVal }],
    [",", { ctor: GVal }],
    ["'", { ctor: Quotation }],
    ["!.", { ctor: SegmentLVal }],
    ["!,", { ctor: SegmentGVal }],
    ["!'", { ctor: SegmentQuotation }],
    ["%", { ctor: ReaderMacro }],
    ["%%", { ctor: VoidReaderMacro }],
]);

// -------------------------------------------------------------------

export class ParseError extends SExpr.SingleToken { }

export class Atom extends SExpr.SingleToken {
    public token!: Token<TokenKind.Atom>;
}
export class Character extends SExpr.SingleToken {
    public token!: Token<TokenKind.Character>;
}
export class Decimal extends SExpr.SingleToken {
    public token!: Token<TokenKind.Decimal>;
}
export class Octal extends SExpr.SingleToken {
    public token!: Token<TokenKind.Octal>;
}
export class ZString extends SExpr.SingleToken {
    public token!: Token<TokenKind.String>;
}

interface SingleTokenMatchEntry {
    ctor: SingleTokenCtor;
}

type SingleTokenCtor = new (token: Token) => SExpr.SingleToken;

const SINGLE_TOKEN_MATCH = new Map<TokenKind, SingleTokenMatchEntry>([
    [TokenKind.Illegal, { ctor: ParseError }],
    [TokenKind.Space, { ctor: ParseError }],
    [TokenKind.Open, { ctor: ParseError } ],
    [TokenKind.Close, { ctor: ParseError } ],
    [TokenKind.Prefix, { ctor: ParseError } ],

    [TokenKind.Atom, { ctor: Atom } ],
    [TokenKind.Character, { ctor: Character } ],
    [TokenKind.Decimal, { ctor: Decimal } ],
    [TokenKind.Octal, { ctor: Octal } ],
    [TokenKind.String, { ctor: ZString } ],
]);
