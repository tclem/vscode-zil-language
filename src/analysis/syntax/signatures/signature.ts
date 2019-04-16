"use strict";

import * as vscode from "vscode";
import { Availability } from "../../scope/index";
import { ZilSymbol, ZilSymbolKind } from "../../symbols/zilsymbol";
import SExpr from "../../syntax/sexpr/sexpr";
import { Token } from "../../syntax/tokens/tokens";

export interface Signature extends Documentable {
    /** The name of the function that defined this one (`DEFINE`, `ROUTINE`, etc.). */
    readonly definingWord?: string;

    /** The name of this function. */
    readonly name: string;

    /** The token that defined the function. */
    readonly nameToken?: Token;

    /** The function's symbol. */
    readonly symbol?: ZilSymbol;

    /** The function's externally visible parameters: required, optional, and `"ARGS"`/`"TUPLE"`/`"CALL"`. */
    readonly params: SignatureParam[];

    /**
     * The function's activation atom, if set.
     *
     * The activation atom can be set two ways:
     *
     *     ;"between the function name and arg spec"
     *     <DEFINE MYFUNC ACTIVATION-ATOM () ...>
     *
     *     ;"as an ACT or NAME parameter"
     *     <DEFINE MYFUNC ("ACT" ACTIVATION-ATOM) ...>
     */
    readonly activationAtom?: Token;

    /** The function's `"BIND"` atom, if set. */
    readonly bindAtom?: Token;

    /** The minimum number of values that must be passed when calling the function. */
    readonly minArgCount: number;

    /**
     * The maximum number of values that may be passed when calling the function, or
     * undefined if there's no limit.
     */
    readonly maxArgCount?: number;

    /** Attributes of the function's return value. */
    readonly returnValue?: DocumentedValue;

    /** Which contexts the function can be called from (Z-code, MDL, or both). */
    readonly availability: Availability;
}

/**
 * A local variable or parameter defined in a function.
 */
export interface LocalVariable extends DocumentedValue {
    /** The name of the variable. */
    readonly name: string;

    /** The token that defined the variable. */
    readonly nameToken?: Token;

    /** The default value that will be assigned (after evaluation) if no value is passed in. */
    readonly defaultValue?: ArgDefaultExpr;
}

/**
 * A parameter defined in a function signature.
 */
export interface SignatureParam extends LocalVariable {
    /** The spec section in which the parameter was defined. */
    readonly section: Section;

    /** Whether a value passed for this parameter will be evaluated before calling the function. */
    readonly isEvaluated: boolean;

    /** Whether this parameter's value can be omitted in a call. */
    readonly isOptional: boolean;

    /** Whether this parameter absorbs all following values in the call (`"ARGS"`, `"TUPLE"`, or `"CALL"`). */
    readonly isVarargs: boolean;
}

export interface Typable {
    readonly constraint?: TypeConstraint;
}

export type PrimType = "ATOM" | "FIX" | "LIST" | "STRING" | "TABLE" | "VECTOR";

export type TypeConstraint =
    { readonly constraint: "applicable" } |
    { readonly constraint: "boolean" } |
    { readonly constraint: "decl"; readonly decl: string } |
    { readonly constraint: "literal"; readonly value: string | ReadonlyArray<string> } |
    { readonly constraint: "primtype"; readonly primtype: PrimType | ReadonlyArray<PrimType> } |
    { readonly constraint: "structured" } |
    { readonly constraint: "type"; readonly type: string | ReadonlyArray<string> };

export interface Documentable {
    readonly docString?: DocString;
}

export interface DocumentedValue extends Typable, Documentable {}

export type ArgDefaultExpr = SExpr;
export type DocString = string;

export const enum Section {
    Required = "",
    ARGS = '"ARGS"',
    AUX = '"AUX"',
    BIND = '"BIND"',
    CALL = '"CALL"',
    NAME = '"NAME"',
    OPT = '"OPT"',
    TUPLE = '"TUPLE"',
}
