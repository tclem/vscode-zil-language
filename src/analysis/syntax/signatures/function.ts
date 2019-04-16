"use strict";

import { Availability } from "../../scope/index";
import { isBinding, parseBinding, SExprReader } from "../../syntax/sexpr/reader";
import SExpr, { List, ZString } from "../../syntax/sexpr/sexpr";
import { Token } from "../../syntax/tokens/tokens";
import { ArgDefaultExpr, LocalVariable, Section, Signature, SignatureParam, TypeConstraint } from "./signature";

class FunctionSigHelper {
    public static buildFrom(def: SExpr.Bracketed, anonymous: boolean): ParseFunctionSignatureResult {
        const helper = new FunctionSigHelper();
        if (def.open.text !== "<") { helper.unexpected(def.open); }

        const buf = new SExprReader(def.contents);

        helper.definer = buf.nextAtom();
        if (!anonymous) { helper.name = buf.nextAtom(); }
        helper.activationAtom = buf.maybeNextAtom();

        const argSpec = buf.nextList();
        helper.processArgs(argSpec);

        // TODO: look for DECL

        const activation: SignatureParam | undefined =
            helper.activationAtom && {
                constraint: { constraint: "type", type: "ACTIVATION" },
                isEvaluated: false,
                isOptional: false,
                isVarargs: false,
                name: helper.activationAtom.text,
                nameToken: helper.activationAtom,
                section: Section.NAME,
            };

        const signature = helper.finish();
        return signature ? { signature, locals: helper.locals, activation } : {};
    }

    private definer?: Token;
    private name?: Token;
    private activationAtom?: Token;
    private bindAtom?: Token;
    private params: SignatureParam[] = [];
    private locals: LocalVariable[] = [];
    private minArgCount = 0;
    private maxArgCount?: number;

    private finish(): Signature | undefined {
        if (!this.definer) { return; }
        const definingWord = this.definer.text;
        const availability =
            definingWord === "ROUTINE" ? Availability.ZCODE :
            definingWord === "DEFMAC" ? Availability.BOTH :
            Availability.MDL;
        return {
            availability,
            definingWord,
            maxArgCount: this.maxArgCount,
            minArgCount: this.minArgCount,
            name: this.name ? this.name.text : "?",
            nameToken: this.name,
            params: this.params,
        };
    }

    private processArgs(argSpec: List) {
        const argBuf = new SExprReader(argSpec.contents);

        let curSection = Section.Required;
        let item: SExpr | undefined;

        // tslint:disable-next-line:no-conditional-assignment
        while (item = argBuf.next()) {
            if (item instanceof ZString) {
                const normalized = this.normalizeSection(item);
                switch (normalized) {
                    case Section.AUX:
                    case Section.OPT:
                        curSection = normalized;
                        break;

                    case Section.ARGS:
                    case Section.CALL:
                    case Section.TUPLE:
                        this.addParameter(normalized, argBuf.nextAtom(), normalized === Section.TUPLE);
                        break;

                    case Section.BIND:
                        this.bindAtom = argBuf.nextAtom();
                        break;
                    case Section.NAME:
                        this.activationAtom = argBuf.nextAtom();
                        break;
                }
            } else if (isBinding(item)) {
                const parsed = parseBinding(item);
                if (curSection === Section.AUX) {
                    this.addLocal(parsed.atom, parsed.defaultValue);
                } else {
                    this.addParameter(curSection, parsed.atom, !parsed.quoted, parsed.defaultValue);
                }
            }
        }
    }

    private normalizeSection(str: ZString): Section {
        switch (str.token.text) {
            case '"ACT"': return Section.NAME;
            case '"ARGS"': return Section.ARGS;
            case '"AUX"': return Section.AUX;
            case '"EXTRA"': return Section.AUX;
            case '"BIND"': return Section.BIND;
            case '"CALL"': return Section.CALL;
            case '"NAME"': return Section.NAME;
            case '"OPT"': return Section.OPT;
            case '"OPTIONAL"': return Section.OPT;
            case '"TUPLE"': return Section.TUPLE;
            default: throw this.unexpected(str);
        }
    }

    private addParameter(section: Section, nameToken: Token, evaluated: boolean, defaultValue?: ArgDefaultExpr) {
        switch (section) {
            case Section.Required:
                this.minArgCount++;
                if (typeof this.maxArgCount !== "undefined") {
                    this.maxArgCount++;
                }
                break;

            case Section.OPT:
                if (typeof this.maxArgCount !== "undefined") {
                    this.maxArgCount++;
                }
                break;

            case Section.ARGS:
            case Section.TUPLE:
                this.maxArgCount = undefined;
                break;
        }

        this.params.push({
            defaultValue,
            isEvaluated: evaluated,
            isOptional: section === Section.OPT,
            isVarargs: section === Section.ARGS || section === Section.TUPLE,
            name: nameToken.text,
            nameToken,
            section,
        });
    }

    private addLocal(nameToken: Token, defaultValue?: ArgDefaultExpr, constraint?: TypeConstraint): LocalVariable {
        const newLocal = { name: nameToken.text, nameToken, defaultValue, constraint };
        this.locals.push(newLocal);
        return newLocal;
    }

    private unexpected(...surprises: Array<Token | SExpr>): never {
        throw new Error(`unexpected: ${surprises.map((s) => s.toString()).join(", ")}`);
    }
}

export interface ParseFunctionSignatureResult {
    signature?: Signature;
    locals?: LocalVariable[];
    activation?: SignatureParam;
}

export function parseFunctionSignature(
    def: SExpr.Bracketed, anonymous: boolean = false): ParseFunctionSignatureResult {

    return FunctionSigHelper.buildFrom(def, anonymous);
}
