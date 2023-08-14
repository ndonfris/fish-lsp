import { homedir } from "os";
import { assert } from "chai";
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import {
    DocumentSymbol,
    Position,
    SymbolKind,
    Location,
} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { Analyzer, findParentScopes, findDefs } from "../src/analyze";
import {
    filterLastPerScopeSymbol,
    FishDocumentSymbol,
} from "../src/document-symbol";
import {
    FishWorkspace,
    initializeDefaultFishWorkspaces,
    Workspace,
} from "../src/utils/workspace";
import { WorkspaceSpoofer } from "./workspace-builder";
import {
    findEnclosingScope,
    getChildNodes,
    getRange,
} from "../src/utils/tree-sitter";
import {
    isCommand,
    isCommandName,
    isFunctionDefinitionName,
    isVariable,
} from "../src/utils/node-types";
import { LspDocument } from "../src/document";
import { containsRange } from "../src/workspace-symbol";

let parser: Parser;
let analyzer: Analyzer;
let allPaths: string[] = [];
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;
let workspaces: FishWorkspace[] = [];
const jestConsole = console;

beforeEach(async () => {
    parser = await initializeParser();
    global.console = require("console");
}, 10000);

afterEach(() => {
    global.console = jestConsole;
    symbols = [];
});

function analyzeConfigDocument() {
    const doc = resolveLspDocumentForHelperTestFile(
        `${homedir()}/.config/fish/config.fish`
    );
    analyzer.analyze(doc);
    return { doc: doc, analyzer: analyzer };
}

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("analyze tests", () => {
    it("checking initializedResult amount/speed", async () => {
        workspaces = await initializeDefaultFishWorkspaces();
        analyzer = new Analyzer(parser, workspaces);
        const initializedResult = await analyzer.initiateBackgroundAnalysis();
        const amount = initializedResult.filesParsed;
        assert.isAbove(amount, 100);
    });

    it("checking spoofed workspace_1", async () => {
        const ws = await WorkspaceSpoofer.create("workspace_1");
        analyzer = new Analyzer(parser, [ws]);
        await analyzer.initiateBackgroundAnalysis();
        const initializedResult = await analyzer.initiateBackgroundAnalysis();
        const amount = initializedResult.filesParsed;
        //analyzer.globalSymbols.allSymbols.forEach((symbol) => {
        //    console.log(symbol.name);
        //})

        const innerUri = ws.findMatchingFishIdentifiers("func-inner").shift()!;
        const symbols = analyzer.cache.getDocumentSymbols(innerUri);
        const tree = filterLastPerScopeSymbol(symbols);
        //logClientTree(tree);
        //console.log(amount);
        //assert.isAbove(amount, 100)
    });

    function setupTestUriAndDoc(
        workspace: WorkspaceSpoofer,
        functionName: string
    ) {
        const testUri = workspace
            .findMatchingFishIdentifiers(functionName)!
            .shift()!;
        const testDoc = workspace.getDocument(testUri)!;
        return { testUri, testDoc };
    }

    function getRenamesForType(
        doc: LspDocument,
        cmdStr: string,
        callbackfn: (node: SyntaxNode) => boolean
    ) {
        const root = analyzer.cache.getRootNode(doc.uri)!;
        let cmdName = getChildNodes(root)
            .filter(callbackfn)
            .find((node) => node.text === cmdStr);
        assert.isDefined(cmdName);
        const cmdNode = cmdName!;
        const cmdNameRange = getRange(cmdNode);
        const searchPosition = cmdNameRange.start;
        const renames = analyzer.getRenames(doc, searchPosition);

        return {
            cmd: cmdNode,
            cmdNameRange: cmdNameRange,
            searchPosition: searchPosition,
            renames: renames,
        };
    }

    it("checking local renames", async () => {
        const ws = await WorkspaceSpoofer.create("workspace_1");
        analyzer = new Analyzer(parser, [ws]);
        await analyzer.initiateBackgroundAnalysis();

        let { testUri, testDoc } = setupTestUriAndDoc(ws, "test-rename-1");
        const { cmdNameRange, searchPosition, renames } = getRenamesForType(
            testDoc,
            "test-rename-inner",
            isCommandName
        );
        assert.deepEqual(cmdNameRange, createTestRange(9, 4, 9, 21));
        assert.equal(renames.length, 2);
    });

    it("checking global function renames", async () => {
        const ws = await WorkspaceSpoofer.create("workspace_1");
        workspaces = [ws];
        analyzer = new Analyzer(parser, workspaces);
        await analyzer.initiateBackgroundAnalysis();

        let { testUri, testDoc } = setupTestUriAndDoc(ws, "test-rename-2");

        const cmdName = "test-rename-1";
        const { cmd, cmdNameRange, searchPosition, renames } =
            getRenamesForType(
                testDoc,
                cmdName,
                (n: SyntaxNode) => n.type === "word"
            );

        assert.equal(renames.length, 2);
    });

    it("checking global variable renames", async () => {
        const ws = await WorkspaceSpoofer.create("workspace_1");
        analyzer = new Analyzer(parser, [ws]);
        await analyzer.initiateBackgroundAnalysis();

        let { testDoc } = setupTestUriAndDoc(
            ws,
            "test-variable-renames"
        );
        const cmdName = "PATH";
        const { renames } = getRenamesForType(testDoc, cmdName, isVariable);
        assert.equal(renames.length, 4);
    });
    
});

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
