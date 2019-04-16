"use strict";

export default class URI {
    public static file(fsPath: string) {
        return new URI(fsPath);
    }

    private constructor(public readonly fsPath: string) {}

    public toString() {
        return `file://${this.fsPath}`;
    }
}
