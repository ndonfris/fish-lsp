import { homedir } from "os";
import { assert } from "chai";
import { printNodes, resolveLspDocumentForHelperTestFile, setLogger } from "./helpers";
import { DocumentSymbol, Position, SymbolKind, Location, } from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { Analyzer, } from "../src/analyze";
import {FishWorkspace,initializeDefaultFishWorkspaces,Workspace,} from "../src/utils/workspace";
import { getChildNodes, getRange } from '../src/utils/tree-sitter';
import { containsRange, findDefinitionSymbols } from '../src/workspace-symbol';
import { FishDocumentSymbol } from '../src/document-symbol';

let parser: Parser;
let analyzer: Analyzer;
let allPaths: string[] = [];
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;
let workspaces: FishWorkspace[] = [];
const jestConsole = console;

function analyzeConfigDocument() {
    const doc = resolveLspDocumentForHelperTestFile(
        `${homedir()}/.config/fish/config.fish`
    );
    analyzer.analyze(doc);
    return { doc: doc, analyzer: analyzer };
}

setLogger(
    async () => {
        parser = await initializeParser();
        analyzer = new Analyzer(parser)
        //await analyzer.initiateBackgroundAnalysis()
    },
    async () => {
        parser.reset()
    }
)

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("analyze tests", () => {

    it("should analyze a document", async () => {
        const document = resolveLspDocumentForHelperTestFile(
            `${homedir()}/.config/fish/functions/test-fish-lsp.fish`,
            true
        )
        analyzer.analyze(document);
        const pos = Position.create(78, 10)
        const defs = findDefinitionSymbols(analyzer, document, pos)
        console.log(defs);
        assert.equal(true, true)
    })
})

function createTestRange(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number
) {
    return {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
    };
}
