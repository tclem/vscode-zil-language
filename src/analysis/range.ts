"use strict";

import * as vscode from "vscode";

import { isArray } from "util";
import { binarySearch as utilBinarySearch } from "../util";
import Document from "./workspace/document";

export class Range {
    public static binarySearch(ranges: Range[], offset: number) {
        const i = this.binarySearchIndex(ranges, offset);
        return i >= 0 ? ranges[i] : undefined;
    }

    public static binarySearchIndex(ranges: Range[], offset: number) {
        return utilBinarySearch(ranges, offset, this.compareToOffset);
    }

    public static compareToOffset(range: Range, offset: number) {
        return range.compareToOffset(offset);
    }

    public static union(...ranges: Range[]) {
        if (!ranges.length) {
            throw new Error("need at least one range");
        }
        if (!ranges.every((r) => r.document === ranges[0].document)) {
            throw new Error("all ranges must come from the same document");
        }
        return new Range(
            ranges[0].document,
            Math.min(...ranges.map((r) => r.start)),
            Math.max(...ranges.map((r) => r.end)),
        );
    }

    constructor(
        public readonly document: Document,
        public readonly start: number,
        public readonly end: number) {}

    public adjust(startOffset: number, endOffset: number): Range {
        return new Range(this.document, this.start + startOffset, this.end + endOffset);
    }

    public compareToOffset(offset: number) {
        if (offset < this.start) { return -1; }
        if (offset >= this.end) { return 1; }
        return 0;
    }

    public contains(offset: number) {
        return this.compareToOffset(offset) === 0;
    }

    public toString() {
        return `{ start: ${this.start}, end: ${this.end}, document: ${this.document} }`;
    }
}

export default Range;

export interface HasRange {
    range: Range;
}

export namespace HasRange {
    export function is(value: any): value is HasRange {
        return value.range instanceof Range;
    }

    type MaybeHasRangeOrArray = undefined | HasRange | Array<undefined | HasRange>;

    function pushRanges(dest: Range[], sources: MaybeHasRangeOrArray[]) {
        for (const s of sources) {
            if (isArray(s)) {
                pushRanges(dest, s);
            } else if (s) {
                dest.push(s.range);
            }
        }
    }

    export function unionRanges(...sources: MaybeHasRangeOrArray[]) {
        const ranges = new Array<Range>();
        pushRanges(ranges, sources);
        return Range.union(...ranges);
    }

    function compareToOffset(item: HasRange, offset: number) {
        return item.range.compareToOffset(offset);
    }

    export function binarySearch<T extends HasRange>(items: T[], offset: number) {
        const i = binarySearchIndex(items, offset);
        return i >= 0 ? items[i] : undefined;
    }

    export function binarySearchIndex<T extends HasRange>(items: T[], offset: number) {
        return utilBinarySearch(items, offset, compareToOffset);
    }

    export function binarySearchInsert<T extends HasRange>(items: T[], newItem: T): T {
        let i = utilBinarySearch(items, newItem.range.start, compareToOffset);
        if (i < 0) {
            i = -i - 1;
        } else {
            throw new Error(`expected offset ${newItem.range.start} to miss ` +
                            `but found index ${i}, range [${items[i].range}]`);
        }
        items.splice(i, 0, newItem);
        return newItem;
    }
}
