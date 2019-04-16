"use strict";

import * as vscode from "vscode";
import { assertNever } from "../../util";
import { Availability } from "../scope";
import { DocString } from "../syntax/signatures/signature";

export enum ZilSymbolKind {
    Action,
    ActivationAtom,
    AuxiliaryLocal,
    BoundLocal,
    CompilationFlag,
    Constant,
    DefinitionBlock,
    DefinitionPackage,
    DefStruct,
    Flag,
    FSubr,
    Function,
    Global,
    Macro,
    NewType,
    Object,
    OptionalLocal,
    Package,
    Property,
    RequiredLocal,
    Room,
    Routine,
    Subr,
    VocabWord,
    ZBuiltin,   // TODO: distinguish builtins and opcodes?
}

// tslint:disable-next-line:no-namespace
export namespace ZilSymbolKind {
    export function toSymbolKind(zk: ZilSymbolKind): vscode.SymbolKind {
        // not a great semantic mapping... these were mostly chosen based on how the icons look
        switch (zk) {
            case ZilSymbolKind.Action: return vscode.SymbolKind.Event;
            case ZilSymbolKind.ActivationAtom: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.AuxiliaryLocal: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.BoundLocal: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.CompilationFlag: return vscode.SymbolKind.Boolean;
            case ZilSymbolKind.Constant: return vscode.SymbolKind.Constant;
            case ZilSymbolKind.DefinitionBlock: return vscode.SymbolKind.Interface;
            case ZilSymbolKind.DefinitionPackage: return vscode.SymbolKind.Interface;
            case ZilSymbolKind.DefStruct: return vscode.SymbolKind.Struct;
            case ZilSymbolKind.Flag: return vscode.SymbolKind.Property;
            case ZilSymbolKind.FSubr: return vscode.SymbolKind.File;
            case ZilSymbolKind.Function: return vscode.SymbolKind.Module;
            case ZilSymbolKind.Global: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.Macro: return vscode.SymbolKind.Array;
            case ZilSymbolKind.NewType: return vscode.SymbolKind.TypeParameter;
            case ZilSymbolKind.Object: return vscode.SymbolKind.Method;
            case ZilSymbolKind.OptionalLocal: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.Package: return vscode.SymbolKind.Interface;
            case ZilSymbolKind.Property: return vscode.SymbolKind.Property;
            case ZilSymbolKind.RequiredLocal: return vscode.SymbolKind.Variable;
            case ZilSymbolKind.Room: return vscode.SymbolKind.Method;
            case ZilSymbolKind.Routine: return vscode.SymbolKind.Module;
            case ZilSymbolKind.Subr: return vscode.SymbolKind.File;
            case ZilSymbolKind.VocabWord: return vscode.SymbolKind.Field;
            case ZilSymbolKind.ZBuiltin: return vscode.SymbolKind.File;
            default: return assertNever(zk);
        }
    }

    export function getFriendlyName(zk: ZilSymbolKind): string {
        switch (zk) {
            case ZilSymbolKind.CompilationFlag:
                return "Compilation Flag";
            case ZilSymbolKind.DefinitionBlock:
                return "Definition Block";
            case ZilSymbolKind.DefinitionPackage:
                return "Package";

            case ZilSymbolKind.VocabWord:
                return "Word";

            case ZilSymbolKind.DefStruct:
            case ZilSymbolKind.FSubr:
            case ZilSymbolKind.NewType:
            case ZilSymbolKind.Subr:
                return ZilSymbolKind[zk].toUpperCase();

            case ZilSymbolKind.ActivationAtom:
                return "Activation";
            case ZilSymbolKind.RequiredLocal:
            case ZilSymbolKind.OptionalLocal:
                return "Parameter";
            case ZilSymbolKind.AuxiliaryLocal:
                return "Local Variable";
            case ZilSymbolKind.Global:
                return "Global Variable";
            case ZilSymbolKind.BoundLocal:
                return "Temporary Variable";

            default:
                return ZilSymbolKind[zk];
        }
    }

    export function isGlobalish(zk: ZilSymbolKind): boolean {
        switch (zk) {
            // Z-code
            case ZilSymbolKind.Constant:
            case ZilSymbolKind.Global:
            case ZilSymbolKind.Object:
            case ZilSymbolKind.Room:
            case ZilSymbolKind.Routine:
            case ZilSymbolKind.Flag:
            // MDL
            case ZilSymbolKind.FSubr:
            case ZilSymbolKind.Subr:
            // either
            case ZilSymbolKind.DefStruct:
            case ZilSymbolKind.Macro:
                return true;

            default:
                return false;
        }
    }

    export function isLocalish(zk: ZilSymbolKind): boolean {
        switch (zk) {
            case ZilSymbolKind.ActivationAtom:
            case ZilSymbolKind.AuxiliaryLocal:
            case ZilSymbolKind.BoundLocal:
            case ZilSymbolKind.OptionalLocal:
            case ZilSymbolKind.RequiredLocal:
                return true;

            default:
                return false;
        }
    }

    export function isCallish(zk: ZilSymbolKind): boolean {
        switch (zk) {
            // Z-code
            // case ZilSymbolKind.Constant: // iffy
            // case ZilSymbolKind.Global:   // iffy
            case ZilSymbolKind.Routine:
            case ZilSymbolKind.ZBuiltin:
            // MDL
            case ZilSymbolKind.FSubr:
            case ZilSymbolKind.Function:
            case ZilSymbolKind.Subr:
            // either
            case ZilSymbolKind.Macro:
                return true;

            default:
                return false;
        }
    }
}

export class ZilSymbol {
    public docString?: DocString;

    constructor(
        public readonly name: string,
        public readonly kind: ZilSymbolKind,
        public readonly availability: Availability,
        public definition?: vscode.Location | undefined,
        public snippet: string = "",
        public parent?: ZilSymbol,
    ) { }

    public hasDefinition(): this is DefinedZilSymbol {
        return typeof this.definition !== "undefined";
    }
}

interface DefinedZilSymbol extends ZilSymbol {
    readonly definition: vscode.Location;
}
