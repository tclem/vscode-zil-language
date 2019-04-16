/* TODO: if we encounter INSERT-FILE, USE, FLOAD, etc. for a file that isn't in the workspace,
 * try to find it in the library path, and tell the user to add it to the workspace (since we can't do it
 * programmatically) */

import * as vscode from "vscode";

import { readFile } from "../../shared/async/fs";
import { evalWithZilf, getWordInContext, WordInContext } from "../../util";
import { FileScope, LanguageContext, Scope } from "../scope/index";
import { ZilSymbol, ZilSymbolKind } from "../symbols/zilsymbol";
import { DocumentAnalyzer } from "../syntax/definitions/docAnalyzer";
import { BuiltinDump, studyBuiltinPatterns } from "../syntax/signatures/builtin";
import { getDefinitionFormatter } from "../syntax/signatures/formatters";
import { Signature, SignatureParam } from "../syntax/signatures/signature";

const GET_BUILTINS = "<PRINC <DESC-BUILTINS!-YOMIN>> <QUIT>";
const GET_VERSION = "<PRINC ,ZIL-VERSION> <QUIT>";
const INDEXABLE_FILE_GLOB = "**/*.{zil,mud}";

export interface Tidbits {
    symbols: ZilSymbol[];
    weakSymbols?: ZilSymbol[];
    signatures: Signature[];
    scope?: Scope;
}

interface DocTidbits extends Tidbits {
    analyzer: DocumentAnalyzer | undefined;
    scope: FileScope;
}

export enum SymbolMatch {
    EXACT = 1,
    SUBSTRING = 2,
}

interface GetSymbolsOptions {
    scope?: Scope;
    languageContext?: LanguageContext;
    match?: SymbolMatch;
    requireMatch?: boolean;
}

type WeakSymbolKey = string;

class Workspace {
    private tidbitsByDocUri = new Map<string, DocTidbits>();
    private builtinTidbits: Tidbits = { symbols: [], signatures: [] };
    private weakSymbolMap?: Map<WeakSymbolKey, ZilSymbol>;
    private builtinConfigResourceUri?: vscode.Uri;
    private disposables = [] as vscode.Disposable[];
    private watcher: vscode.FileSystemWatcher;

    constructor(private context: vscode.ExtensionContext) {
        this.watcher = vscode.workspace.createFileSystemWatcher(INDEXABLE_FILE_GLOB);
        this.disposables.push(this.watcher);
        this.watcher.onDidCreate((uri) => this.processUri(uri, "created"), undefined, this.disposables);
        this.watcher.onDidChange((uri) => this.processUri(uri, "changed"), undefined, this.disposables);
        this.watcher.onDidDelete((uri) => this.purgeUri(uri, "deleted"), undefined, this.disposables);

        vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
            const handleAddition = async (f: vscode.WorkspaceFolder) => {
                const uris = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(f, INDEXABLE_FILE_GLOB));
                return Promise.all(uris.map((uri) => this.processUri(uri, "added to the workspace")));
            };

            const handleRemoval = (f: vscode.WorkspaceFolder) => {
                const folderUri = f.uri.toString();
                const goners: string[] = [];
                for (const docUri of this.tidbitsByDocUri.keys()) {
                    if (docUri.startsWith(folderUri)) {
                        goners.push(docUri);
                    }
                }
                goners.forEach((uri) => this.purgeUri(uri, "removed from the workspace"));
            };

            try {
                await Promise.all(
                    e.added.map<void>(handleAddition)
                        .concat(e.removed.map(handleRemoval)));
            } catch (err) {
                console.log(err);
            }
        }, undefined, this.disposables);

        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration("zil", this.builtinConfigResourceUri)) {
                try {
                    await this.refreshBuiltins();
                } catch (err) {
                    console.log(err);
                }
            }
        }, undefined, this.disposables);
    }

    public async start() {
        await Promise.all([
            this.processMatchingWorkspaceFiles().catch((err) => console.log(err)),
            this.refreshBuiltins().catch((err) => console.log(err)),
        ]);
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    public getDocumentSymbols(documentUri: vscode.Uri, query?: string): ZilSymbol[] {
        const tidbits = this.tidbitsByDocUri.get(documentUri.toString());
        let symbols = tidbits && tidbits.symbols || [];
        if (query) {
            symbols = this.filterSymbolsByName(symbols, query, SymbolMatch.SUBSTRING);
        }
        return symbols;
    }

    /**
     * Fetches symbols, optionally filtering by name and context.
     * @param query A string or WordInContext. If omitted, the function will return all symbols.
     *   If a string, the function will match it as a substring in symbols.
     *   If a WordInContext, the function will match its text exactly, and
     *   possibly filter the symbols by kind based on context.
     * @param options
     */
    public getSymbols(query?: string | WordInContext, options: GetSymbolsOptions = {}): ZilSymbol[] {
        // TODO: split into multiple functions?

        // check options
        const languageContext = options.languageContext || (options.scope && options.scope.languageContext);

        // load symbols
        let result = this.getAllSymbols(options.scope);

        // filter symbols
        if (typeof query === "string") {
            result = this.filterSymbolsByName(result, query, options.match || SymbolMatch.SUBSTRING);
            if (languageContext) {
                result = this.filterSymbolsByContext(result, { languageContext });
            }
        } else if (query) {
            if (query.found) {
                result = this.filterSymbolsByName(result, query.text, options.match || SymbolMatch.EXACT);
            } else if (options.requireMatch) {
                return [];
            }
            if (query.prefix || languageContext) {
                result = this.filterSymbolsByContext(result, { prefix: query.prefix, languageContext });
            }
        }
        return result;
    }

    /**
     * Finds all the symbols referenced at a given position in a text document, based on the text leading up to it.
     * @param document The document to search.
     * @param position The position within the document to search.
     * @param options
     */
    public getSymbolsAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position,
        options: GetSymbolsOptions = {},
    ) {
        const word = getWordInContext(document, position);
        const offset = document.offsetAt(position);

        const analyzer = this.getDocumentAnalyzer(document);
        const callSiteContext = analyzer.findCallSiteContext(offset);
        const scope = analyzer.findScope(offset);

        const symbols = this.getSymbols(
            word,
            {
                ...options,
                languageContext: callSiteContext.argLanguageContext,
                scope,
            },
        );

        return { word, callSiteContext, scope, symbols };
    }

    /**
     * Finds all known signatures for functions with the given name.
     * @param name The name of the function being called.
     * @param context Controls whether we find functions that can be called from MDL, Z-code, or both.
     */
    public getSignatures(name: string, context?: LanguageContext): Signature[] {
        const result: Signature[] = [];
        for (const tb of this.tidbitsByDocUri.values()) {
            if (!tb.signatures) { continue; }
            for (const s of tb.signatures) {
                // TODO: case-insensitive comparison?
                if (s.name === name) {
                    result.push(s);
                }
            }
        }
        result.push(...this.builtinTidbits.signatures.filter((s) => s.name === name));
        return context
            ? result.filter((s) => s.availability.includes(context))
            : result;
    }

    /**
     * Constructs a DocumentAnalyzer for a document, or returns a cached one if available.
     * @param doc The TextDocument to analyze.
     */
    public getDocumentAnalyzer(doc: vscode.TextDocument): DocumentAnalyzer {
        const tidbits = this.tidbitsByDocUri.get(doc.uri.toString());
        if (!tidbits) {
            // not part of the workspace? don't bother caching
            return new DocumentAnalyzer(doc, new FileScope(doc));
        }
        if (!tidbits.analyzer || tidbits.analyzer.doc.isClosed || tidbits.analyzer.analyzedVersion !== doc.version) {
            if (!tidbits.scope) { tidbits.scope = new FileScope(doc); }
            tidbits.analyzer = new DocumentAnalyzer(doc, tidbits.scope);
        }
        return tidbits.analyzer;
    }

    private getAllSymbols(scope?: Scope): ZilSymbol[] {
        const result = [] as ZilSymbol[];
        if (scope) {
            while (scope && !(scope instanceof FileScope)) {
                result.push(...scope.symbols);
                scope = scope.parent;
            }
        }
        for (const tidbits of this.tidbitsByDocUri.values()) {
            if (tidbits.symbols) { result.push(...tidbits.symbols); }
        }
        if (!this.weakSymbolMap) {
            this.weakSymbolMap = this.makeWeakSymbolMap();
        }
        result.push(...this.weakSymbolMap.values());
        result.push(...this.builtinTidbits.symbols);
        return result;
    }

    private makeWeakSymbolMap(): Map<WeakSymbolKey, ZilSymbol> {
        const result = new Map<WeakSymbolKey, ZilSymbol>();
        for (const tidbits of this.tidbitsByDocUri.values()) {
            if (!tidbits.weakSymbols) { continue; }
            for (const ws of tidbits.weakSymbols) {
                const key = `${ws.name}_${ws.kind}`;
                // TODO: combine weak symbols instead of only using the first one encountered
                if (!result.has(key)) { result.set(key, ws); }
            }
        }
        return result;
    }

    private filterSymbolsByName(symbols: ZilSymbol[], query: string, mode: SymbolMatch): ZilSymbol[] {
        const upperQuery = query.toUpperCase();
        switch (mode) {
            case SymbolMatch.EXACT:
                return symbols.filter((r) => r.name.toUpperCase() === upperQuery);
            case SymbolMatch.SUBSTRING:
                return symbols.filter((r) => r.name.toUpperCase().includes(upperQuery));
        }
    }

    private filterSymbolsByContext(
        symbols: ZilSymbol[],
        filters: { prefix?: string, languageContext?: LanguageContext }) {

        if (filters.prefix) {
            if (filters.prefix.endsWith(",")) {
                symbols = symbols.filter((s) => ZilSymbolKind.isGlobalish(s.kind));
            } else if (filters.prefix.endsWith(".")) {
                symbols = symbols.filter((s) => ZilSymbolKind.isLocalish(s.kind));
            } else if (filters.prefix.endsWith("<")) {
                symbols = symbols.filter((s) => ZilSymbolKind.isCallish(s.kind));
            }
        }

        if (filters.languageContext) {
            const lctx = filters.languageContext;
            symbols = symbols.filter((s) => s.availability.includes(lctx));
        }

        return symbols;
    }

    private async refreshBuiltins(): Promise<void> {
        try {
            let builtinsData: object;
            let wsfolder: vscode.WorkspaceFolder | undefined;
            try {
                const { stdout, folder } = await evalWithZilf(GET_BUILTINS);
                builtinsData = JSON.parse(stdout);
                wsfolder = folder;
            } catch {
                const { stdout, folder } = await evalWithZilf(GET_VERSION);
                const theFile = this.context.asAbsolutePath(`data/builtins/${stdout}.json`);
                builtinsData = JSON.parse(await readFile(theFile, "utf8"));
                wsfolder = folder;
            }
            this.processBuiltins(builtinsData as BuiltinDump);
            this.builtinConfigResourceUri = wsfolder && wsfolder.uri;
        } catch (e) {
            console.log(e);
            vscode.window.showWarningMessage(`Help for builtins will be unavailable: ${e}`);
        }
    }

    private processBuiltins(parsed: BuiltinDump): void {
        const symbols: ZilSymbol[] = [];
        const signatures: Signature[] = [];

        for (const name in parsed) {
            if (parsed.hasOwnProperty(name)) {
                const { signatures: curSigs, symbols: curSyms } = studyBuiltinPatterns(name, parsed[name]);
                if (!curSigs || !curSyms) {
                    console.log(`failed building sigs for "${name}"`);
                    continue;
                }
                signatures.push(...curSigs);
                symbols.push(...curSyms);
            }
        }

        this.builtinTidbits = { symbols, signatures };
        console.log(`[symbols] loaded ${symbols.length} builtins`);
    }

    private async processMatchingWorkspaceFiles() {
        try {
            const findWorkspaceFiles = (f: vscode.WorkspaceFolder) =>
                vscode.workspace.findFiles(new vscode.RelativePattern(f, INDEXABLE_FILE_GLOB));
            const promises = (vscode.workspace.workspaceFolders || []).map(findWorkspaceFiles);
            for (const uris of await Promise.all(promises)) {
                uris.forEach((uri) => this.processUri(uri, "present in the workspace"));
            }
        } catch (err) {
            console.log(err);
        }
    }

    private async processUri(uri: vscode.Uri, reason: string) {
        console.log(`[symbols] processing ${uri} (${reason})`);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const scope = new FileScope(doc);
            const analyzer = new DocumentAnalyzer(doc, scope);
            const symbols: ZilSymbol[] = [];
            const weakSymbols: ZilSymbol[] = [];
            const signatures: Signature[] = [];

            for (const { tidbits } of analyzer.findDefinitions()) {
                try {
                    if (tidbits) {
                        if (tidbits.symbols) { symbols.push(...tidbits.symbols); }
                        if (tidbits.signatures) { signatures.push(...tidbits.signatures); }
                        if (tidbits.weakSymbols) {
                            weakSymbols.push(...tidbits.weakSymbols);
                            this.weakSymbolMap = undefined;
                        }
                    }
                } catch (err) {
                    console.log(err);
                }
            }
            console.log(`[symbols] loaded ${symbols.length} symbols and ${signatures.length} signatures from ${uri}`);
            this.tidbitsByDocUri.set(uri.toString(), { symbols, signatures, analyzer, scope, weakSymbols });
        } catch (err) {
            console.log(err);
        }
    }

    private purgeUri(uri: string | vscode.Uri, reason: string) {
        console.log(`[symbols] purging ${uri} (${reason})`);
        this.tidbitsByDocUri.delete(uri.toString());
    }
}

let workspace: Workspace;

export function getWorkspace() {
    if (workspace === undefined) {
        throw new Error("workspace not yet initialized");
    }
    return workspace;
}

export async function startWorkspace(context: vscode.ExtensionContext): Promise<vscode.Disposable> {
    if (!workspace) {
        workspace = new Workspace(context);
        await workspace.start();
    }
    return workspace;
}
