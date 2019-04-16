"use strict";

import * as vscode from "vscode";

import { isUndefined } from "util";
import { binarySearch } from "../../util";
import { HasRange, Range } from "../range";
import { ZilSymbol } from "../symbols/zilsymbol";

export abstract class Availability {
    public static from(lctx: LanguageContext): Availability {
        switch (lctx.lang) {
            case Lang.BOTH:
                return Availability.BOTH;
            case Lang.MDL:
                return Availability.MDL;
            case Lang.ZCODE:
                // TODO: do we need to use lctx.version?
                return Availability.ZCODE;
        }
    }

    public abstract readonly lang: Lang;
    public abstract includes(lctx: LanguageContext): boolean;
    public abstract toString(): string;
}

export namespace Availability {
    export const MDL: Availability = new (class extends Availability {
        public get lang() { return Lang.MDL; }
        // tslint:disable-next-line:no-bitwise
        public includes(lctx: LanguageContext) { return !!(lctx.lang & Lang.MDL); }
        public toString() { return "MDL"; }
    })();

    export const BOTH: Availability = new (class extends Availability {
        public get lang() { return Lang.BOTH; }
        public includes(lctx: LanguageContext) { return true; }
        public toString() { return "MDL + Z-code"; }
    })();

    class AllZcode extends Availability {
        public get lang() { return Lang.ZCODE; }
        // tslint:disable-next-line:no-bitwise
        public includes(lctx: LanguageContext) { return !!(lctx.lang & Lang.ZCODE); }
        public toString() { return "Z-code"; }
    }

    class SomeZcode extends Availability {
        constructor(private minVersion: ZVersion, private maxVersion?: ZVersion) {
            super();
        }

        public get lang() { return Lang.ZCODE; }

        public includes(lctx: LanguageContext) {
            if (lctx.lang === Lang.ZCODE && lctx.version) {
                return lctx.version >= this.minVersion &&
                    (this.maxVersion === undefined || lctx.version <= this.maxVersion);
            }

            // tslint:disable-next-line:no-bitwise
            return !!(lctx.lang & Lang.ZCODE);
        }

        public toString() {
            if (this.maxVersion === undefined) {
                return `Z-code (V${this.minVersion}+)`;
            }
            if (this.minVersion === this.maxVersion) {
                return `Z-code (V${this.minVersion})`;
            }
            return `Z-code (V${this.minVersion}-${this.maxVersion})`;
        }
    }

    function makeSomeZcode(minVersion: ZVersion, maxVersion?: ZVersion): Availability {
        return new SomeZcode(minVersion, maxVersion);
    }
    makeSomeZcode.constructor = AllZcode;
    Object.setPrototypeOf(makeSomeZcode, AllZcode.prototype);

    export const ZCODE: Availability & typeof makeSomeZcode = Object.assign(makeSomeZcode, new AllZcode());
}

export type LanguageContext =
    { lang: Lang.MDL } |
    { lang: Lang.ZCODE, version?: ZVersion } |
    { lang: Lang.BOTH };

export type ZVersion = 3 | 4 | 5 | 6 | 7 | 8;

export enum Lang {
    MDL = 1,
    ZCODE = 2,
    BOTH = 3,
}

export class Scope {
    public readonly children: Scope[] = [];
    public readonly symbols: ZilSymbol[] = [];

    protected constructor(public readonly range: Range,
                          public readonly languageContext: LanguageContext,
                          public readonly parent?: Scope) { }

    /**
     * Returns the innermost scope containing a given offset.
     * @param offset The offset to find.
     * @returns This scope, or one of its children.
     */
    public findInnerScope(offset: number): Scope {
        let result: Scope = this;
        while (result.children.length) {
            const child = HasRange.binarySearch(result.children, offset);
            if (!child) { break; }
            result = child;
        }
        return result;
    }

    public addInnerScope(range: Range, languageContext?: LanguageContext): Scope {
        const inner = this.findInnerScope(range.start);
        if (inner.range.end < range.end) {
            throw new Error("new scope would cross existing scopes");
        }
        const newScope = new Scope(range, languageContext || this.languageContext, inner);
        HasRange.binarySearchInsert(inner.children, newScope);
        return newScope;
    }
}

export class FileScope extends Scope {
    public readonly uri: vscode.Uri;
    public readonly parent?: never;

    constructor(doc: vscode.TextDocument) {
        const wholeDocRange = new Range(doc, 0, doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end));
        super(wholeDocRange, { lang: Lang.MDL });
        this.uri = doc.uri;
    }
}
