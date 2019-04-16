"use strict";

/**
 * This file contains the stream catcher
 * it's basically given an input and out stream
 * it takes requests and generates a response from the streams
 */

import { Readable, Writable } from "stream";
import { logger } from "vscode-debugadapter/lib/main";
import * as RX from "./regExp";

interface RequestTask {
    command: string | null;
    resolve: PromiseResolver;
    reject: PromiseRejecter;
}

type PromiseResolver<T = string[]> = (result?: T) => void;
type PromiseRejecter = (reason?: any) => void;

export class StreamCatcher {
    public debug = true;   // XXX

    public ready = false;
    public input?: Writable;

    private requestQueue: RequestTask[] = [];
    private requestRunning?: RequestTask;

    private buffer = [""];

    private _isReady: Promise<string[]>;

    constructor() {
        // Listen for a ready signal
        this._isReady = new Promise((resolve) => {
            this.request(null)
                .then((res) => {
                    if (this.debug) { logger.verbose("Got ready signal"); }
                    this.ready = true;
                    resolve(res);
                })
                .catch(() => { /* nada */ });
        });
    }

    public shutdown() {
        if (this.requestQueue) {
            this.requestQueue.forEach((req) => req.reject("shutdown"));
            this.requestQueue = [];
        }
        if (this.requestRunning) {
            this.requestRunning.reject("shutdown");
            delete this.requestRunning;
        }
    }

    public launch(input: Writable, output: Readable) {
        this.input = input;

        let lastBuffer = "";
        const timeout: NodeJS.Timer | null = null;
        output.on("data", (buffer) => {
            // if (this.debug) { logger.verbose("RAW: " + buffer.toString()); }
            const data = lastBuffer + buffer.toString();
            const lines = data.split(/\r\n?|\n/);
            const firstLine = lines[0];
            const lastLine = lines[lines.length - 1];
            const commandIsDone = RX.lastCommandLine.test(lastLine);

            if (/[\r\n]$/.test(data) || commandIsDone) {
                lastBuffer = "";
            } else {
                lastBuffer = lines.pop() || "";
            }
            for (const line of lines) {
                this.readline(line);
            }
        });
    }

    public readline(line: string) {
        if (this.debug) { logger.verbose("From debug process: " + line); }
        // if (this.debug) logger.verbose('data:', [...line]);
        this.buffer.push(line);
        // Test for command end
        if (RX.lastCommandLine.test(line)) {
            if (this.debug) { logger.verbose("END: " + line); }
            const data = this.buffer;
            this.buffer = [];
            this.resolveRequest(data);
        }
    }

    public resolveRequest(data: string[]) {
        const req = this.requestRunning;
        if (req) {
            if (req.command) {
                data.unshift(req.command);
            }

            req.resolve(data);
            // Reset state making room for next task
            this.buffer = [];
            delete this.requestRunning;
        }
        this.nextRequest();
    }

    public nextRequest() {
        if (!this.requestRunning && this.requestQueue.length) {
            // Set new request
            this.requestRunning = this.requestQueue.shift()!;
            // this.logOutput(`NEXT: ${this.requestRunning.command}\n`);
            // a null command is used for the initial run, in that case we don't need to
            // do anything but listen
            if (this.requestRunning.command !== null && this.input) {
                this.input.write(`${this.requestRunning.command}\n`);
            }
        }
    }

    public request(command: string | null): Promise<string[]> {
        if (this.debug) { logger.verbose(command ? `To debug process: "${command}"` : "Debug process init"); }
        return new Promise((resolve, reject) => {
            // Add our request to the queue
            this.requestQueue.push({
                command,
                reject,
                resolve,
            });

            this.nextRequest();
        });
    }

    public interrupt(command: string) {
        if (this.debug) { logger.verbose(`To debug process (bypassing queue): "${command}"`); }
        if (this.input) { this.input.write(`${command}\n`); }
    }

    public interruptIfBusy(command: string) {
        if (this.requestRunning) { this.interrupt(command); }
    }

    public whenReady() {
        return this._isReady;
    }
}
