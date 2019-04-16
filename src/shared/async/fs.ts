"use strict";

import * as fs from "fs";

export function exists(path: string | Buffer): Promise<boolean> {
    return new Promise((resolve, reject) => fs.exists(path, resolve));
}

export function readFile(filename: string, encoding: null): Promise<Buffer>;
export function readFile(filename: string, encoding: string): Promise<string>;
export function readFile(filename: string, encoding: string | null): Promise<string | Buffer>;

export function readFile(filename: string, encoding: string | null) {
    return new Promise((resolve, reject) => fs.readFile(filename, encoding, (err, data) => {
        if (err) { reject(err); } else { resolve(data); }
    }));
}
