/* Based on Clojure Warrior, copyright (c) 2017 Nikita Prokopov, MIT licensed */

// tslint:disable:variable-name

import isEqual = require("lodash.isequal");
import { isArray } from "util";
import * as vscode from "vscode";
import { Position, Range, Selection } from "vscode";

interface ZilTextEditor extends vscode.TextEditor {
    document: ZilTextDocument;
}

interface ZilTextDocument extends vscode.TextDocument {
    languageId: "zil";
}

type BracketColor = string | vscode.ThemeColor | Array<string | vscode.ThemeColor>;

type OpenBracket = "(" | "[" | "{" | "<";
type CloseBracket = ")" | "]" | "}" | ">";

export default function startBrackets(context: vscode.ExtensionContext) {
    const pairs: { [k in CloseBracket]: OpenBracket; } = { ")": "(", "]": "[", "}": "{", ">": "<" };
    function opening(char: string): char is OpenBracket {
        return char === "(" || char === "[" || char === "{" || char === "<";
    }
    function closing(char: string): char is CloseBracket {
        return char === ")" || char === "]" || char === "}" || char === ">";
    }
    function position_str(pos: Position) { return "" + pos.line + ":" + pos.character; }
    function is_zil(editor: vscode.TextEditor | undefined): editor is ZilTextEditor {
        return !!editor && editor.document.languageId === "zil";
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("zil.jumpToMatchingBracket", jumpToMatchingBracket),
        vscode.commands.registerCommand("zil.selectToMatchingBracket", selectToMatchingBracket),
    );

    let activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    let rainbowColors: BracketColor[] = [];
    let rainbowTypes: vscode.TextEditorDecorationType[] = [];
    let cycleBracketColors: boolean;
    let misplacedBracketStyle: vscode.DecorationRenderOptions;
    let misplacedType: vscode.TextEditorDecorationType;
    let matchedBracketStyle: vscode.DecorationRenderOptions | null;
    let matchedType: vscode.TextEditorDecorationType;
    let bracketPairs: Map<string, Position> = new Map();
    let rainbowTimer: NodeJS.Timer | undefined;

    if (is_zil(activeEditor)) {
        reloadConfig();
    }

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        activeEditor = editor;
        if (is_zil(editor)) {
            scheduleRainbowBrackets();
        }
    }, null, context.subscriptions);

    vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor && is_zil(event.textEditor)) {
            matchPairs();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument((event) => {
        if (is_zil(activeEditor) && event.document === activeEditor.document) {
            scheduleRainbowBrackets();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeConfiguration((event) => {
        reloadConfig();
        scheduleRainbowBrackets();
    }, null, context.subscriptions);

    function decorationType(opts: vscode.DecorationRenderOptions) {
        opts.rangeBehavior = vscode.DecorationRangeBehavior.ClosedClosed;
        return vscode.window.createTextEditorDecorationType(opts);
    }

    function colorDecorationType(color: BracketColor) {
        if (isArray(color)) {
            return decorationType({ light: { color: color[0] }, dark: { color: color[1] } });
        } else {
            return decorationType({ color });
        }
    }

    function reloadConfig() {
        if (activeEditor) {
            const configuration = vscode.workspace.getConfiguration("zil", activeEditor.document.uri);
            let dirty = false;
            const enabled = configuration.get<boolean>("rainbowBrackets.enabled");

            const configuredColors = enabled ? configuration.get<BracketColor[]>("rainbowBrackets.bracketColors")! : [];
            if (!isEqual(rainbowColors, configuredColors)) {
                if (rainbowTypes) { rainbowTypes.forEach((type) => type.dispose()); }
                rainbowColors = configuredColors;
                rainbowTypes = rainbowColors.map(colorDecorationType);
                dirty = true;
            }

            if (cycleBracketColors !== configuration.get<boolean>("rainbowBrackets.cycleBracketColors")) {
                cycleBracketColors = configuration.get("rainbowBrackets.cycleBracketColors", false);
                dirty = true;
            }

            if (!isEqual(misplacedBracketStyle, configuration.get("misplacedBracketStyle"))) {
                if (misplacedType) { misplacedType.dispose(); }
                misplacedBracketStyle = configuration.get<vscode.DecorationRenderOptions>("misplacedBracketStyle")!;
                misplacedType = decorationType(misplacedBracketStyle);
                dirty = true;
            }

            if (!isEqual(matchedBracketStyle, configuration.get("matchedBracketStyle"))) {
                if (matchedType) { matchedType.dispose(); }
                matchedBracketStyle = configuration.get<vscode.DecorationRenderOptions>("matchedBracketStyle")!;
                matchedType = decorationType(matchedBracketStyle);
                dirty = true;
            }

            if (dirty) {
                scheduleRainbowBrackets();
            }
        }
    }

    function scheduleRainbowBrackets() {
        if (rainbowTimer) {
            clearTimeout(rainbowTimer);
        }
        if (is_zil(activeEditor)) {
            rainbowTimer = setTimeout(updateRainbowBrackets, 16);
        }
    }

    function updateRainbowBrackets() {
        if (!is_zil(activeEditor) || !rainbowTypes.length) { return; }

        const regexp = /(\\.|;\s*|<\s*>|[ \t-\r,#\':%\(\)\[\]<>\{\}"])/gs;
        const doc = activeEditor.document;
        const text = doc.getText();
        const enabled = vscode.workspace.getConfiguration("zil", doc.uri).get<boolean>("rainbowBrackets.enabled")!;
        const rainbow: vscode.DecorationOptions[][] = rainbowTypes.map(() => []);
        const misplaced: vscode.DecorationOptions[] = [];
        const len = rainbowTypes.length;
        const colorIndex: (n: number) => number = cycleBracketColors ? ((i) => i % len) : ((i) => Math.min(i, len - 1));

        let match: RegExpExecArray | null;
        let in_string = false;
        let in_comment = false;
        const comment_start_depth: number[] = [];
        const stack: Array<{ char: OpenBracket | CloseBracket; pos: Position; pair_idx?: number }> = [];
        let stack_depth = 0;
        bracketPairs = new Map();
        // tslint:disable-next-line:no-conditional-assignment
        while (match = regexp.exec(text)) {
            const char = match[0];
            if (char[0] === "\\") {
                continue;
            } else if (in_string) {
                if (char === "\"") {
                    in_string = false;
                    if (in_comment && comment_start_depth[0] === stack_depth) {
                        comment_start_depth.shift();
                        in_comment = comment_start_depth.length > 0;
                    }
                    continue;
                }
            } else if (char[0] === ";") {
                in_comment = true;
                comment_start_depth.unshift(stack_depth);
                continue;
            } else if (char === "\"") {
                in_string = true;
                continue;
            } else if (opening(char)) {
                const pos = activeEditor.document.positionAt(match.index);
                if (enabled && !in_comment) {
                    const decoration = { range: new Range(pos, pos.translate(0, 1)) };
                    rainbow[colorIndex(stack_depth)].push(decoration);
                }
                ++stack_depth;
                stack.push({ char, pos, pair_idx: undefined });
                continue;
            } else if (closing(char)) {
                const pos = activeEditor.document.positionAt(match.index);
                const decoration = { range: new Range(pos, pos.translate(0, 1)) };
                let pair_idx = stack.length - 1;
                while (pair_idx >= 0 && stack[pair_idx].pair_idx !== undefined) {
                    pair_idx = stack[pair_idx].pair_idx! - 1;
                }
                if (pair_idx === undefined || pair_idx < 0 || stack[pair_idx].char !== pairs[char]) {
                    // TODO: only do this if `enabled`
                    // color misplaced brackets even if in a comment
                    misplaced.push(decoration);
                } else {
                    const pair = stack[pair_idx];
                    stack.push({ char, pos, pair_idx });
                    bracketPairs.set(position_str(pos), pair.pos);
                    bracketPairs.set(position_str(pair.pos), pos);
                    --stack_depth;
                    if (enabled) {
                        rainbow[colorIndex(stack_depth)].push(decoration);
                    }
                    if (in_comment && comment_start_depth[0] >= stack_depth) {
                        comment_start_depth.shift();
                        in_comment = comment_start_depth.length > 0;
                    }
                }
                continue;
            } else {
                // atom separator
                if (in_comment && comment_start_depth[0] === stack_depth) {
                    comment_start_depth.shift();
                    in_comment = comment_start_depth.length > 0;
                }
                continue;
            }
        }
        for (let i = 0; i < rainbowTypes.length; ++i) {
            activeEditor.setDecorations(rainbowTypes[i], rainbow[i]);
        }
        activeEditor.setDecorations(misplacedType, misplaced);
        matchPairs();
    }

    function matchBefore(doc: vscode.TextDocument, cursor: Position): Position | undefined {
        if (cursor.character > 0) {
            const cursor_before = cursor.translate(0, -1);
            const range_before = new Range(cursor_before, cursor);
            const char_before = doc.getText(range_before);
            if (closing(char_before)/* || !opening(char_after)*/) {
                return bracketPairs.get(position_str(cursor_before));
            }
        }
    }

    function matchAfter(doc: vscode.TextDocument, cursor: Position): Position | undefined {
        const cursor_after = cursor.translate(0, 1);
        if (cursor_after.line === cursor.line) {
            const range_after = new Range(cursor, cursor_after);
            const char_after = doc.getText(range_after);
            if (opening(char_after)/* || !closing(char_before)*/) {
                return bracketPairs.get(position_str(cursor));
            }
        }
    }

    function matchPairs() {
        if (!is_zil(activeEditor)) { return; }

        const matches: vscode.DecorationOptions[] = [];
        const doc = activeEditor.document;
        activeEditor.selections.forEach((selection) => {
            const cursor = selection.active;
            const match_before = cursor.isBeforeOrEqual(selection.anchor) && matchBefore(doc, cursor);
            const match_after = cursor.isAfterOrEqual(selection.anchor) && matchAfter(doc, cursor);
            if (match_before) {
                matches.push({ range: new Range(cursor.translate(0, -1), cursor) });
                matches.push({ range: new Range(match_before, match_before.translate(0, 1)) });
            }
            if (match_after) {
                matches.push({ range: new Range(cursor, cursor.translate(0, 1)) });
                matches.push({ range: new Range(match_after, match_after.translate(0, 1)) });
            }
        });
        activeEditor.setDecorations(matchedType, matches);
    }

    function jumpToMatchingBracket() {
        if (!is_zil(activeEditor)) { return; }

        const doc = activeEditor.document;

        activeEditor.selections = activeEditor.selections.map((selection) => {
            const cursor = selection.active;
            const match_before = matchBefore(doc, cursor);
            const match_after = matchAfter(doc, cursor);
            if (match_before) {
                return new Selection(match_before, match_before);
            } else if (match_after) {
                return new Selection(match_after.translate(0, 1), match_after.translate(0, 1));
            } else {
                return selection;
            }
        });
        activeEditor.revealRange(activeEditor.selections[0]);
    }

    function selectToMatchingBracket() {
        if (!is_zil(activeEditor)) { return; }

        const doc = activeEditor.document;

        activeEditor.selections = activeEditor.selections.map((selection) => {
            const cursor = selection.active;
            const match_before = matchBefore(doc, cursor);
            const match_after = matchAfter(doc, cursor);
            if (match_before) {
                return new Selection(cursor, match_before);
            } else if (match_after) {
                return new Selection(cursor, match_after.translate(0, 1));
            } else {
                return selection;
            }
        });
        activeEditor.revealRange(new Range(activeEditor.selections[0].active, activeEditor.selections[0].active));
    }
}
