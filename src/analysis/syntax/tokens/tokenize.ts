"use strict";

import Range from "../../range";
import Document from "../../workspace/document";
import { Token, TokenKind } from "./tokens";

const ATOMLIKE_REGEX = /(?:\\.|[^!. \t-\r,#':;%()\[\]<>\{\}"])(?:\\.|[^ \t-\r,#':;%()\[\]<>\{\}"])*/;
const CHARACTER_REGEX = /!\\./;
const CLOSE_REGEX = /!?[\)\]\>\}]/;
const OPEN_REGEX = /!?[\(\[\<\{]/;
const PREFIX_REGEX = /!?[.,;'#]|%%?/;
const SPACE_REGEX = /\s+/;
const STRING_REGEX = /"(?:\\.|[^"])*"/;

const TOKEN_REGEX = new RegExp(
    // must match up with TOKEN_MATCH_TYPES below
    [ATOMLIKE_REGEX, CHARACTER_REGEX, CLOSE_REGEX, OPEN_REGEX,
     PREFIX_REGEX, SPACE_REGEX, STRING_REGEX]
    .map((re) => `(${re.source})`).join("|"),
    "g");
const TOKEN_MATCH_TYPES: TokenKind[] = [
    TokenKind.Atom, TokenKind.Character, TokenKind.Close, TokenKind.Open,
    TokenKind.Prefix, TokenKind.Space, TokenKind.String];

const ATOMLIKE_DECIMAL_REGEX = /^-?[0-9]+$/;
const ATOMLIKE_OCTAL_REGEX = /^\*[0-7]+\*$/;

function* tokenize(document: Document) {
    let match: RegExpExecArray | null;
    let lastPos = 0;
    const inputText = document.getText();
    // tslint:disable-next-line:no-conditional-assignment
    while (match = TOKEN_REGEX.exec(inputText)) {
        if (match.index > lastPos) {
            // we skipped some garbage
            yield mktoken(TokenKind.Illegal, lastPos, match.index);
        }
        let type: TokenKind | undefined;
        for (let i = 1; i < match.length; i++) {
            if (match[i] !== undefined) {
                type = TOKEN_MATCH_TYPES[i - 1];
                break;
            }
        }
        if (!type) {
            throw new Error("BUG");
        }
        lastPos = match.index + match[0].length;
        yield mktoken(type, match.index, lastPos);
    }

    if (lastPos < inputText.length - 1) {
        // garbage at the end
        yield mktoken(TokenKind.Illegal, lastPos, inputText.length);
    }

    // helper
    function mktoken(kind: TokenKind, rangeStart: number, rangeEnd: number): Token {
        const tokenText = inputText.substring(rangeStart, rangeEnd);
        if (kind === TokenKind.Atom) {
            if (ATOMLIKE_DECIMAL_REGEX.test(tokenText)) {
                kind = TokenKind.Decimal;
            } else if (ATOMLIKE_OCTAL_REGEX.test(tokenText)) {
                kind = TokenKind.Octal;
            }
        }
        return new Token(kind, tokenText, new Range(document, rangeStart, rangeEnd));
    }
}

export default tokenize;
