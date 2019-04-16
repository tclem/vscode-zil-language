"use strict";

export const colors = /\u001b\[([0-9]+)m|\u001b/g;

export interface ZcodeAddress {
    /** The unpacked Z-Machine address, in lowercase hex with $ prefix. */
    address: string;

    /**
     * The address as an offset from its containing routine, if known.
     * The value is given as a routine name followed by "+" and a number of bytes.
     */
    routineOffset?: string;

    /** A reference to the source line containing the address, if known. */
    source?: {
        /** The relative path to the source file. */
        file: string;
        /** The line number, starting at 1. */
        line: number;
    };
}

export interface BreakPointConfirmation extends ZcodeAddress {
    /** Whether this breakpoint has been set or cleared. */
    action: "set" | "cleared";
}

const _zcodeAddr = /(\$[0-9a-f]+)(?: \((\S+\+\d+)(?:, (.*):(\d+))?\))?/;
const _bpConfirmation = /^(Set|Cleared) breakpoint at (.*)\.$/;

export function matchZcodeAddress(line: string): ZcodeAddress | null {
    const m = line.match(_zcodeAddr);
    if (!m) { return null; }
    const result: ZcodeAddress = { address: m[1] };
    if (m[2]) { result.routineOffset = m[2]; }
    if (m[3] && m[4]) { result.source = { file: m[3], line: +m[4] }; }
    return result;
}

export function matchBreakPointConfirmation(line: string): BreakPointConfirmation | null {
    const m = line.match(_bpConfirmation);
    if (!m) { return null; }
    const za = matchZcodeAddress(m[2]);
    if (!za) { return null; }
    return { ...za, action: m[1].toLowerCase() as any };
}

export const breakpoints = {
    ignore: /^(\d+|No) breakpoint/,
};

export function matchPrintedExpression(line: string): { name?: string, value?: string } {
    const m = line.match(/^(?:(\S+)\s+=\s+)?(.+)/);
    return m ? { name: m[1], value: m[2] } : {};
}

export interface CurrentLocationMatchResult {
    linesUsed: 0 | 1 | 2;
    location?: ZcodeAddress;
    disassembly?: string;
    sourceCode?: string;
}

export function matchCurrentLocation(line1: string, line2?: string): CurrentLocationMatchResult {
    let m = line1.match(/^(\$[0-9a-f]+)(?:\s+\((\S+\+\d+)\))?\s+(.*)$/);
    if (!m) { return { linesUsed: 0 }; }
    const [, address, routineOffset, disassembly] = m;
    const result: CurrentLocationMatchResult = {
        disassembly,
        linesUsed: 1,
        location: {
            address,
            routineOffset,
        },
    };
    if (line2) {
        m = line2.match(/^(.+):(\d+): (.*)$/);
        if (m) {
            const [, file, line, sourceCode] = m;
            result.linesUsed = 2;
            result.location!.source = { file, line: +line };
            result.sourceCode = sourceCode;
        }
    }
    return result;
}

export const localVars = {
    end: /^(?:\d+ words?|No data) on stack|No (?:call frame|local variable)/,
    ignore: /^\d+ local variable/,
    variable: /^\s*(\S+) = (\$[0-9a-f]+) \((.*)\)$/,
};

export const globalVars = {
    variable: /^\s*(\S+) = (\$[0-9a-f]+) \((.*)\)$/,
};

export const objectTree = {
    object: /^([ |`]*)- (?:(.*?)\s+)?#(\d+) \("(.*)"\)$/,
};

export const objectDetails = {
    attribute: /^\s*attribute (?:(.*?)\s+)?#(\d+)$/,
    ignore: /^(?:Attributes:|=+)$/,
    objectHeader: /^=+ (?:(.*?)\s+)?#(\d+) \("(.*)"\) =+$/,
    propData: /^\s*(?: [0-9a-f]{2})+$/,
    propHeader: /^\s*property (?:(.*?)\s+)?#(\d+) \(length (\d+)\):$/,
    propTableHeader: /^Properties \(table at (\$[0-9a-f]+)\):$/,
    treePointer: /^(Parent|Sibling|Child): (?:(.*?)\s+)?#(\d+) \("(.*)"\)$/,
};

export const stackTrace = {
    frame: /^(?:\[(\d+)\] return )?PC = (.*)$/,
    ignore: /^(?:Call depth|=+$|called with|storing|discarding)/,
};

export function cleanLine(line: string) {
    return line.replace(colors, "").replace(/\s|(\\b)/g, "").replace("\b", "");
}

export function isGarbageLine(line: string) {
    return cleanLine(line) === "" || lastCommandLine.test(line);
}

const pauseReasonRegExps = {
    breakpoint: /breakpoint/,
    entry: /entry point/,
    step: /step/,
    user: /user request/,
};

export type PauseReason = keyof typeof pauseReasonRegExps;

export const programCondition = {
    exception: /^\*\*\* ERROR \((.*?)\): (.*)$/,
    paused: /^Game is paused \((.*)\)\.$/,
    terminated: /^Game has ended.$/,

    pauseReasonPatterns: pauseReasonRegExps as Record<PauseReason, RegExp>,
    pauseReasons: Object.keys(pauseReasonRegExps) as PauseReason[],
};

export const lastCommandLine = /^D>\s*$/;
