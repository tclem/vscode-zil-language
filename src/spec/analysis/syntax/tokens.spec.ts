"use strict";

// tslint:disable:object-literal-sort-keys

import Range from "../../../analysis/range";
import SExpr, { Atom, List, Quotation, UVector } from "../../../analysis/syntax/sexpr/sexpr";
import tokenize from "../../../analysis/syntax/tokens/tokenize";
import { Token, TokenKind } from "../../../analysis/syntax/tokens/tokens";
import Document from "../../../analysis/workspace/document";
import URI from "../../../analysis/workspace/uri";

function mockDocument(input: string): Document {
    return {
        uri: URI.file("mock_document.zil"),
        version: 1,
        getText: () => input,
    };
}

describe("tokenize", () => {
    it("yields no tokens for an empty input", () => {
        const doc = mockDocument("");
        const tokens = Array.from(tokenize(doc));

        expect(tokens).toEqual([]);
    });

    it("tokenizes a form", () => {
        const doc = mockDocument("<+ 1 !.FOO\\>  ![]>");
        const tokens = Array.from(tokenize(doc));

        expect(tokens).toEqual([
            new Token(TokenKind.Open, "<", new Range(doc, 0, 1)),
            new Token(TokenKind.Atom, "+", new Range(doc, 1, 2)),
            new Token(TokenKind.Space, " ", new Range(doc, 2, 3)),
            new Token(TokenKind.Decimal, "1", new Range(doc, 3, 4)),
            new Token(TokenKind.Space, " ", new Range(doc, 4, 5)),
            new Token(TokenKind.Prefix, "!.", new Range(doc, 5, 7)),
            new Token(TokenKind.Atom, "FOO\\>", new Range(doc, 7, 12)),
            new Token(TokenKind.Space, "  ", new Range(doc, 12, 14)),
            new Token(TokenKind.Open, "![", new Range(doc, 14, 16)),
            new Token(TokenKind.Close, "]", new Range(doc, 16, 17)),
            new Token(TokenKind.Close, ">", new Range(doc, 17, 18)),
        ]);
    });

    it("handles strings with escaped quote marks", () => {
        const doc = mockDocument(`hello "embedded\\\"quote" goodbye`);
        const tokens = Array.from(tokenize(doc));

        expect(tokens).toEqual([
            new Token(TokenKind.Atom, "hello", new Range(doc, 0, 5)),
            new Token(TokenKind.Space, " ", new Range(doc, 5, 6)),
            new Token(TokenKind.String, "\"embedded\\\"quote\"", new Range(doc, 6, 23)),
            new Token(TokenKind.Space, " ", new Range(doc, 23, 24)),
            new Token(TokenKind.Atom, "goodbye", new Range(doc, 24, 31)),
        ]);
    });
});

describe("SExpr.parseMany", () => {
    it("yields no exprs for an empty input", () => {
        const doc = mockDocument("");
        const tokens = tokenize(doc);
        const exprs = Array.from(SExpr.parseMany(tokens));

        expect(exprs).toEqual([]);
    });

    it("yields single token exprs for unstructured inputs", () => {
        const doc = mockDocument("a b c");
        const tokens = tokenize(doc);
        const exprs = Array.from(SExpr.parseMany(tokens));

        expect(exprs).toEqual([
            new Atom(new Token(TokenKind.Atom, "a", new Range(doc, 0, 1))),
            new Atom(new Token(TokenKind.Atom, "b", new Range(doc, 2, 3))),
            new Atom(new Token(TokenKind.Atom, "c", new Range(doc, 4, 5))),
        ]);
    });

    it("yields structured exprs for structured inputs", () => {
        //                                  1
        //                        012345678901
        const doc = mockDocument("(a b c) '![]");
        const tokens = tokenize(doc);
        const exprs = Array.from(SExpr.parseMany(tokens));

        expect(exprs).toEqual([
            new List(
                new Token(TokenKind.Open, "(", new Range(doc, 0, 1)),
                [
                    new Atom(new Token(TokenKind.Atom, "a", new Range(doc, 1, 2))),
                    new Atom(new Token(TokenKind.Atom, "b", new Range(doc, 3, 4))),
                    new Atom(new Token(TokenKind.Atom, "c", new Range(doc, 5, 6))),
                ],
                new Token(TokenKind.Close, ")", new Range(doc, 6, 7)),
            ),
            new Quotation(
                new Token(TokenKind.Prefix, "'", new Range(doc, 8, 9)),
                new UVector(
                    new Token(TokenKind.Open, "![", new Range(doc, 9, 11)),
                    [],
                    new Token(TokenKind.Close, "]", new Range(doc, 11, 12)),
                ),
            ),
        ]);
    });
});

describe("SExpr.drillInto", () => {
    it("yields no exprs for empty input", () => {
        const doc = mockDocument("");
        const tokens = tokenize(doc);
        const exprs = Array.from(SExpr.parseMany(tokens));
        const drilled = Array.from(SExpr.drillInto(exprs, 0));

        expect(drilled).toEqual([]);
    });

    it("drills into structures", () => {
        //                                  1         2
        //                        012345678901234567890
        const doc = mockDocument("foo (bar '(baz)) quux");
        const tokens = tokenize(doc);
        const exprs = Array.from(SExpr.parseMany(tokens));
        const drilled = Array.from(SExpr.drillInto(exprs, 12));

        const joc = jasmine.objectContaining.bind(jasmine);

        expect(drilled.length).toEqual(4);
        expect(drilled[0].range).toEqual(new Range(doc, 4, 16));
        expect(drilled[1].range).toEqual(new Range(doc, 9, 15));
        expect(drilled[2].range).toEqual(new Range(doc, 10, 15));
        expect(drilled[3].range).toEqual(new Range(doc, 11, 14));
    });
});
