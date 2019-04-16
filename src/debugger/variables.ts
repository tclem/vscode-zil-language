"use strict";

import { Handles, Variable } from "vscode-debugadapter";
import { DebugProtocol } from "vscode-debugprotocol/lib/debugProtocol";
import { Debugger, ZObject, ZProperty, ZTreeObject, ZVariable } from "./zlr";

type FilterType = "all"; // XXX "named" | "indexed" | "all";

export interface VariableHostSession {
    readonly debugger: Debugger;
    readonly handles: Handles<VariableContainer>;
}

export interface VariableContainer {
  expand(
    session: VariableHostSession,
    filter: FilterType,
    start?: number,
    count?: number,
  ): Promise<DebugProtocol.Variable[]>;

  setValue(
    session: VariableHostSession,
    name: string,
    value: string,
  ): Promise<DebugProtocol.Variable>;
}

interface VariableExpandArgs {
    readonly session: VariableHostSession;
    readonly filter: FilterType;
    readonly start?: number;
    readonly count?: number;
 }

abstract class ScopedVariableContainer<T extends ZVariable = ZVariable> implements VariableContainer {
    public async expand(session: VariableHostSession, filter: FilterType, start?: number, count?: number) {
        const args = { session, filter, start, count };
        const zvars = await this.fetchZvars(args);
        const mapped = await Promise.all(zvars.map((zv) => this.convertZvar(args, zv)));
        return this.sortVars(args, mapped);
    }

    public setValue(session: VariableHostSession, name: string, value: string) {
        return Promise.reject<DebugProtocol.Variable>(new Error("not implemented"));
    }

    protected abstract fetchZvars(args: VariableExpandArgs): Promise<T[]>;

    protected convertZvar(args: VariableExpandArgs, { name, value, rawValue }: T) {
        return Promise.resolve<DebugProtocol.Variable>(new Variable(name, value !== undefined ? value : rawValue));
    }

    protected sortVars(args: VariableExpandArgs, vars: DebugProtocol.Variable[]) {
        return vars.sort((a, b) => a.name.localeCompare(b.name));
    }
}

// TODO: use heuristics and/or extend debug info to detect types of variables for better formatting

export class LocalScopeContainer extends ScopedVariableContainer {
    constructor(public readonly frameId: number) { super(); }

    public async fetchZvars(args: VariableExpandArgs) {
        return await args.session.debugger.getLocalVariables(this.frameId);
    }

    public async convertZvar(args: VariableExpandArgs, zv: ZVariable) {
        return Object.assign(await super.convertZvar(args, zv),
            { evaluateName: `.${zv.name}`, presentationHint: { kind: "data", visibility: "private" } });
    }
}

export class GlobalScopeContainer extends ScopedVariableContainer {
    public async fetchZvars(args: VariableExpandArgs) {
        return await args.session.debugger.getGlobalVariables();
    }

    public async convertZvar(args: VariableExpandArgs, zv: ZVariable) {
        return Object.assign(await super.convertZvar(args, zv),
            { evaluateName: `,${zv.name}`, presentationHint: { kind: "data", visibility: "public" } });
    }
}

export class ObjectScopeContainer implements VariableContainer {
  public async expand(
    session: VariableHostSession,
    filter: FilterType,
    start?: number | undefined,
    count?: number | undefined,
  ): Promise<DebugProtocol.Variable[]> {
    const objects = await session.debugger.getObjectTree();
    return objects.sort(compareNameAndNumber).map(convertObject);

    function convertObject(zto: ZTreeObject): Variable {
      return {
        name: zto.name || `#${zto.number}`,
        value: `#${zto.number} "${zto.desc}"`,
        variablesReference: session.handles.create(
          new ObjectDetailsContainer(zto.number),
        ),
      };
    }
  }

  public async setValue(
    session: VariableHostSession,
    name: string,
    value: string,
  ): Promise<DebugProtocol.Variable> {
    throw new Error("Method not implemented.");
  }
}

interface HasNameAndNumber {
    name?: string;
    number: number;
}

function compareNameAndNumber(a: HasNameAndNumber, b: HasNameAndNumber) {
    if (a.name === undefined && b.name === undefined) {
        return a.number - b.number;
    }
    if (a.name !== undefined && b.name !== undefined) {
        return a.name.localeCompare(b.name);
    }
    return (a.name || `#${a.number}`).localeCompare(b.name || `#${b.number}`);
}

function citeObject(obj: ZObject | undefined) {
    if (!obj) { return "<N/A>"; }
    const parts = ["#", obj.number.toString(), ' "', obj.desc, '"'];
    if (obj.name) { parts.unshift(obj.name, " "); }
    return parts.join("");
}

function bytesToUshort(hi: number, lo: number) {
    // tslint:disable-next-line:no-bitwise
    return ((hi << 8) & 255) | (lo & 255);
}

function bytesToShort(hi: number, lo: number) {
    return ushortToShort(bytesToUshort(hi, lo));
}

function ushortToShort(ushort: number) {
    // tslint:disable-next-line:no-bitwise
    return (ushort & 65535 ^ 32768) - 32768;
}

function formatPropData({ length, data }: ZProperty) {
    switch (length) {
        case 1:
            return data[0].toString();

        case 2:
            return bytesToShort(data[0], data[1]).toString();

        default:
            const parts: string[] = [];
            let i: number;
            for (i = 0; i + 1 < length; i += 2) {
                parts.push(`\$${data[i].toString(16)}${data[i + 1].toString(16)}`);
            }
            if (i < length) {
                parts.push(`\$${data[i].toString(16)}`);
            }
            return parts.join(" ");
    }
}

export class ObjectDetailsContainer implements VariableContainer {
    constructor(public readonly obj: number | string) { }

    public async expand(
        session: VariableHostSession,
        filter: FilterType,
        start?: number | undefined,
        count?: number | undefined,
    ): Promise<DebugProtocol.Variable[]> {
        const detail = await session.debugger.getObjectDetails(this.obj);

        // object properties, ordered by name
        const result = detail.properties
            .sort(compareNameAndNumber)
            .map<DebugProtocol.Variable>((prop) => {
                const name = prop.name ? prop.name.replace(/^[Pp]\?/, "") : `P#${prop.number}`;
                const value = formatPropData(prop);

                return {
                    evaluateName: `<GETP${prop.length > 2 ? "T" : ""} ${this.obj} ${prop.number}>`,
                    name,
                    presentationHint: { kind: "property", visibility: "public" },
                    value,
                    variablesReference: 0,
                };
            }, this);

        // important pseudo-properties at the beginning
        result.unshift(
            {
                evaluateName: `<LOC ${this.obj}>`,
                name: "[LOC]",
                presentationHint: { attributes: ["readOnly"], kind: "virtual" },
                type: "object",
                value: citeObject(detail.parent),
                variablesReference: 0,
            },
            {
                name: "[FLAGS]",
                presentationHint: { kind: "data" },
                type: "flags",
                value: detail.attributes.map((a) => a.name || `#${a.number}`).join(" "),
                variablesReference: 0,
            },
        );

        // less important pseudo-properties at the end
        result.push(
            {
                name: "[DESC]",
                presentationHint: { attributes: ["readOnly"], kind: "data" },
                type: "string",
                value: `"${detail.desc}"`,
                variablesReference: 0,
            },
            {
                evaluateName: `<NEXT? ${this.obj}>`,
                name: "[NEXT?]",
                presentationHint: { attributes: ["readOnly"], kind: "virtual" },
                type: "object",
                value: citeObject(detail.sibling),
                variablesReference: 0,
            },
            {
                evaluateName: `<FIRST? ${this.obj}>`,
                name: "[FIRST?]",
                presentationHint: { attributes: ["readOnly"], kind: "virtual" },
                type: "object",
                value: citeObject(detail.child),
                variablesReference: 0,
            },
        );

        return result;
    }

    public setValue(
        session: VariableHostSession,
        name: string,
        value: string,
    ): Promise<DebugProtocol.Variable> {
        throw new Error("Method not implemented.");
    }
}
