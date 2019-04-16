"use strict";

import { isArray } from "util";

const enum State { UNUSED, GOING, SOURCE_DONE, DONE }

export default class Buffer<T> {
    public get eof(): boolean {
        if (this.state === State.UNUSED) { this.peek(); }
        return this.state === State.DONE;
    }

    private source: IterableIterator<T>;
    private state = State.UNUSED;
    private pushedBack: T[] = [];

    constructor(source: IterableIterator<T> | T[]) {
        this.source = isArray(source) ? source[Symbol.iterator]() : source;
    }

    public peek<U extends T>(predicate: (v: T) => v is U): U | undefined;
    public peek(predicate?: (v: T) => boolean): T | undefined;

    public peek(predicate?: (v: T) => boolean): T | undefined {
        const result = this.next();
        if (typeof result === "undefined") { return; }
        this.pushedBack.push(result);
        if (this.state === State.DONE) { this.state = State.SOURCE_DONE; }
        if (predicate && !predicate(result)) { return; }
        return result;
    }

    public next(): T | undefined {
        if (this.state === State.DONE) { return; }
        if (this.pushedBack.length) {
            const res = this.pushedBack.pop();
            if (!this.pushedBack.length) {
                if (this.state === State.SOURCE_DONE) { this.state = State.DONE; }
            }
            return res;
        }
        const { done, value } = this.source.next();
        if (done) {
            this.state = State.DONE;
            return;
        }
        this.state = State.GOING;
        this.peek();
        return value;
    }

    public maybeNext<U extends T>(predicate: (v: T) => v is U): U | undefined;
    public maybeNext(predicate?: (v: T) => boolean): T | undefined;

    public maybeNext(predicate?: (v: T) => boolean): T | undefined {
        const result = this.peek(predicate);
        if (typeof result !== "undefined") {
            this.next();
        }
        return result;
    }
}
