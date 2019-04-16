"use strict";

import { DebugProtocol } from "vscode-debugprotocol/lib/debugProtocol";
type Message = DebugProtocol.Message;

let nextId = 100;

function msg<K extends string>(format: string): (variables: Record<K, string>) => Message {
    const id = nextId++;
    return (variables) => ({ id, format, variables });
}

// tslint:disable:variable-name

export const FeatureNotImplemented =
    msg<"feature">(
        "{feature} not implemented",
    );
export const UnknownEvalContext =
    msg<"context" | "expr">(
        'Unknown eval context "{context}" for expression "{expr}"',
    );
export const Exception =
    msg<"op" | "message">(
        "Exception during {op}: {message}",
    );
