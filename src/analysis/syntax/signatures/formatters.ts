"use strict";

import { isArray } from "util";
import { ELLIPSIS, ZWS } from "../../../util";
import SExpr from "../../syntax/sexpr/sexpr";
import { ArgDefaultExpr, Section, Signature, SignatureParam } from "./signature";

export abstract class SignatureFormatter {
    protected static elide(s: string, maxLength: number): string {
        return s.length > maxLength ? ELLIPSIS : s;
    }

    /**
     * Formats a parameter's name.
     * @param param The parameter to format.
     */
    public formatParamName(param: SignatureParam): string {
        return param.name;
    }

    /**
     * Formats a signature as a string.
     * @param sig The signature to format.
     */
    public abstract format(sig: Signature): string;

    /**
     * Formats a single parameter as a string.
     * @param param The parameter to format.
     */
    public abstract formatParam(param: SignatureParam): string;

    /**
     * Formats the parameter list as individual strings.
     * @param params The array of parameters to format.
     */
    protected formatParamParts(params: SignatureParam[]): Iterable<string> {
        return params.map(this.formatParam.bind(this));
    }

    /**
     * Formats the parameter list as a single string, joining the sequence returned by
     * {@formatParamParts}.
     * @param params The array of parameters to format.
     */
    protected formatParamList(params: SignatureParam[]): string {
        const parts = this.formatParamParts(params);
        const array = isArray(parts) ? parts as string[] : Array.from(parts);
        return array.join(" ");
    }

    /**
     * Formats the name of the defining function
     * @param word The name of the function that defined this one.
     */
    protected formatDefiningWord(word: string): string {
        return word;
    }

    protected formatFunctionName(name: string): string {
        return name;
    }

    protected formatDefaultValue(expr: ArgDefaultExpr): string {
        return SignatureFormatter.elide(expr.toString(), 10);
    }
}

class DefinitionFormatter extends SignatureFormatter {
    public static readonly instance = new DefinitionFormatter();

    public format(sig: Signature): string {
        const definingWord = this.formatDefiningWord(sig.definingWord || ";DEFINE");
        const name = this.formatFunctionName(sig.name);
        const params = this.formatParamList(sig.params);
        return `<${definingWord} ${name} (${params}) ${ELLIPSIS}>`;
    }

    public formatParam(param: SignatureParam): string {
        let result = this.formatParamName(param);
        if (!param.isEvaluated && (param.section === Section.Required || param.section === Section.OPT)) {
            result = "'" + result;
        }
        return param.defaultValue
            ? `(${result} ${this.formatDefaultValue(param.defaultValue)})`
            : result;
    }

    public formatParamName(param: SignatureParam): string {
        return param.name.toUpperCase();
    }

    /** Overridden to insert strings marking the parameter sections. */
    protected* formatParamParts(params: SignatureParam[]) {
        let lastSection = Section.Required;
        for (const p of params) {
            const str = this.formatParam(p);
            if (p.section !== lastSection) {
                yield `${p.section} ${str}`;
                lastSection = p.section;
            } else {
                yield str;
            }
        }
    }
}

class CallSiteFormatter extends SignatureFormatter {
    public format(sig: Signature): string {
        const name = this.formatFunctionName(sig.name);
        const params = this.formatParamList(sig.params);
        return `<${name}${params ? " " : ""}${params}>`;
    }

    public formatParam(param: SignatureParam): string {
        const name = this.formatParamName(param);
        if (!param.isOptional) {
            return param.isVarargs ? `${name}${ELLIPSIS}` : name;
        } else if (param.isVarargs) {
            return `[${name}${ELLIPSIS}]`;
        } else if (param.defaultValue) {
            const defaultValue = this.formatDefaultValue(param.defaultValue);
            return `[${name} = ${defaultValue}]`;
        } else {
            return `[${name}]`;
        }
    }

    public formatParamName(param: SignatureParam): string {
        // surround parameter names with unicode zero-width space so the signature help popup will match them correctly
        return ZWS + param.name.toLowerCase() + ZWS;
    }
}

let callSiteFormatterInstance: CallSiteFormatter | undefined;
let definitionFormatterInstance: DefinitionFormatter | undefined;

export function getCallSiteFormatter(): CallSiteFormatter {
    return (callSiteFormatterInstance || (callSiteFormatterInstance = new CallSiteFormatter()));
}

export function getDefinitionFormatter(): DefinitionFormatter {
    return (definitionFormatterInstance || (definitionFormatterInstance = new DefinitionFormatter()));
}
