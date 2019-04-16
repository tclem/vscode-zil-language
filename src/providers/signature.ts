"use strict";

import * as vscode from "vscode";
import { Disposable, ExtensionContext, MarkdownString } from "vscode";
import { Range } from "../analysis/range";
import { ZilSymbolKind } from "../analysis/symbols/zilsymbol";
import SExpr from "../analysis/syntax/sexpr/sexpr";
import { getCallSiteFormatter } from "../analysis/syntax/signatures/formatters";
import { Signature, SignatureParam, Typable } from "../analysis/syntax/signatures/signature";
import { getWorkspace } from "../analysis/workspace/workspace";
import { ZIL_MODE } from "../util";

class SignatureProvider implements vscode.SignatureHelpProvider {
    public provideSignatureHelp(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): vscode.ProviderResult<vscode.SignatureHelp> {

        try {
            const docAnalyzer = getWorkspace().getDocumentAnalyzer(document);
            const offset = document.offsetAt(position);
            const { callForm, callLanguageContext, argIndex } = docAnalyzer.findCallSiteContext(offset);
            if (!callForm || !callForm.contents.length) {
                console.log(`[params] no form at ${position.line},${position.character}`);
                return;
            }

            const name = callForm.contents[0].toString();
            const signatures = getWorkspace().getSignatures(name, callLanguageContext);
            if (!signatures.length) {
                console.log(`[params] no signatures for "${name}"`);
                return;
            }

            const resolvedSignatures = resolveSignatures(signatures, argIndex!);

            const result = new vscode.SignatureHelp();
            result.signatures = resolvedSignatures.signatureInfos;
            result.activeSignature = resolvedSignatures.activeSignature;
            result.activeParameter = resolvedSignatures.activeParameter;
            console.log(
                `[params] ${result.signatures.length} signatures for "${name}", activeSig=${result.activeSignature}, ` +
                `activeParam=${result.activeParameter}`);
            return result;
        } catch (err) {
            console.log(err);
        }

        function resolveSignatures(signatures: Signature[], argIndex: number) {
            const temp = signatures.map((s) => {
                /* TODO: walk the call site arguments through the signature params to filter out non-matches
                 * and get the correct argIndex when optional and varargs are involved */
                const sigLabel = getCallSiteFormatter().format(s);
                const sigInfo = new vscode.SignatureInformation(sigLabel, sigDocString(s));
                for (const p of s.params) {
                    const paramLabel = getCallSiteFormatter().formatParam(p);
                    const paramInfo = new vscode.ParameterInformation(paramLabel, paramDocString(s, p));
                    sigInfo.parameters.push(paramInfo);
                }
                const sigArgIndex = typeof s.maxArgCount === "undefined"
                    ? Math.min(argIndex, s.params.length - 1)
                    : argIndex;
                const inBounds = sigArgIndex < s.params.length;
                return { sigInfo, sigArgIndex, inBounds };
            });
            temp.sort((a, b) =>
                b.sigArgIndex - a.sigArgIndex ||
                a.sigInfo.parameters.length - b.sigInfo.parameters.length);
            const signatureInfos = temp.map((rs) => rs.sigInfo);
            const activeSignature = Math.max(0, temp.findIndex((rs) => rs.inBounds));
            const activeParameter = temp[activeSignature].sigArgIndex;

            // TODO: rearrange parameters of other signatures so the correct param is highlighted in each one

            return { signatureInfos, activeSignature, activeParameter };
        }

        function sigDocString(sig: Signature): string | MarkdownString {
            if (sig.docString) { return sig.docString; }

            const result = new MarkdownString();

            if (sig.symbol) {
                if (sig.symbol.hasDefinition()) {
                    result.appendText(`Defined at: ${sig.symbol.definition.uri.fsPath} ` +
                                      `line ${sig.symbol.definition.range.start.line}  \n`);
                }
                result.appendText(`Kind: ${ZilSymbolKind.getFriendlyName(sig.symbol.kind)}  \n`);
            }

            result.appendText(`Return type: ${formatType(sig.returnValue)}  \n`);
            return result;
        }

        function paramDocString(sig: Signature, param: SignatureParam): string | MarkdownString {
            if (param.docString) { return param.docString; }

            const result = new MarkdownString();

            result.appendText(`Type: ${formatType(param)}  \n`);
            result.appendText(`Evaluated: ${param.isEvaluated}  \n`);

            return result;
        }

        function formatType(t: Typable | undefined): string {
            const tc = t && t.constraint;
            if (!tc) { return "any"; }

            switch (tc.constraint) {
                case "decl": return tc.decl;
                case "literal": return flatten(tc.value);
                case "primtype": return `primtype-${tc.primtype}`;
                case "type": return flatten(tc.type);

                case "applicable":
                case "boolean":
                case "structured":
                default:
                    return tc.constraint;
            }

            function flatten(value: string | ReadonlyArray<string>) {
                return typeof value === "string" ? value : value.join("|");
            }
        }
    }
}

export default function registerSignatureProvider(context: ExtensionContext): Disposable[] {
    const provider = new SignatureProvider();
    return [
        vscode.languages.registerSignatureHelpProvider(ZIL_MODE, provider, " ", "\n"),
    ];
}
