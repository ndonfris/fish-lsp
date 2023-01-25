import { resolveLspDocumentForHelperTestFile } from "./helpers";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    CompletionParams,
    DocumentSymbol,
    MarkupContent,
    MarkupKind,
    Position,
    Range,
    SymbolKind,
    TextDocumentIdentifier,
} from "vscode-languageserver";
import {
    BUILT_INS,
    createCompletionList,
    generateShellCompletionItems,
    getShellCompletions,
    workspaceSymbolToCompletionItem,
} from "../src/completion";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { resolve } from "dns";
import { LspDocument } from "../src/document";
import {
    containsRange,
    createSymbol,
    //getDefinitionSymbols,
    getNearbySymbols,
    getNodeFromRange,
} from "../src/workspace-symbol";
import {
    getChildNodes,
    getNodeAtRange,
    getRange,
    getRangeWithPrecedingComments,
} from "../src/utils/tree-sitter";
import { Color } from "colors";
import { Analyzer } from "../src/analyze";
import {
    isFunctionDefinition,
    isFunctionDefinitionName,
    isDefinition,
    isVariableDefinition,
    isScope,
} from "../src/utils/node-types";
import { collectAllSymbolInformation, CommentRange } from "../src/symbols";
import {
    DocumentationCache,
    initializeDocumentationCache,
} from "../src/utils/documentationCache";

let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;

const jestConsole = console;

beforeEach(async () => {
    global.console = require("console");
    parser = await initializeParser();
    documentationCache = await initializeDocumentationCache();
    analyzer = new Analyzer(parser, documentationCache);
    symbols = [];
});

afterEach(() => {
    global.console = jestConsole;
    parser.delete();
});

function pushCommentRanges(doc: LspDocument) {
    const root: SyntaxNode = parser.parse(doc.getText()).rootNode;
    const nodes = getChildNodes(root).filter((node) => isDefinition(node));
    const commentRanges: CommentRange.WithPrecedingComments[] = [];
    nodes.forEach((node) => {
        commentRanges.push(CommentRange.create(node));
    });
    return commentRanges;
}

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("workspace-symbols tests", () => {
    it("simple function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile(
            "./fish_files/simple/simple_function.fish"
        );
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    it("simple variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile(
            "./fish_files/simple/set_var.fish"
        );
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    it("simple for variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile(
            "./fish_files/simple/for_var.fish"
        );
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    it("function with variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile(
            "./fish_files/simple/function_variable_def.fish"
        );
        //const commentRanges = pushCommentRanges(doc)
        analyzer.analyze(doc);
        //const symbols = collectAllSymbolInformation(doc.uri, parser.parse(doc.getText()).rootNode)
        const root = parser.parse(doc.getText()).rootNode
        const symbols = collapseToSymbolsRecursive(root);
        const tree = toClientTree(root)
        expect(symbols.length).toBe(1);
        expect(tree.length).toBe(1);
    });


    it("multiple function hierarchical symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile(
            "./fish_files/advanced/multiple_functions.fish"
        );
        const root = parser.parse(doc.getText()).rootNode
        const symbols = collapseToSymbolsRecursive(root);
        symbols.forEach((symbol, index) => {
            console.log(symbol.name);
            //console.log(symbol.name)
            console.log(
                JSON.stringify(
                    { index: index, children: symbol.children },
                    null,
                    2
                )
            );
        });
        expect(symbols.length).toBe(3);
        console.log("\nLOGGING SCOPES:");
        const tree = toClientTree(root)
        logClientTree(tree)

        //expect(tree.length).toBe(1);
        //console.log(
                //JSON.stringify(
                    //{tree},
                    //null,
                    //2
                //)
        //);
        //const result = await analyzer.getDefinition(doc, toFind[0])
        //result.forEach(n => {
        //console.log(n);
        //console.log();
        //})
        //console.log(toFind[0]?.text);
        //expect(commentRanges.length).toBe(3);
    });

});


// small helper to print out the client tree like the editor would tree
function logClientTree(symbols: DocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        console.log("  ".repeat(level) + `${logIcon}${symbol.name}`);
        logClientTree(symbol.children || [], level + 1);
    }
}


/****************************************************************************************
 *  here we need to add collecting comments, for the range/detail output. Generate      *
 *  a special detail output. And lastly probably would be more simple using a namespace *
 *                                                                                      *
 ***************************************************************************************/
function createFunctionDocumentSymbol(node: SyntaxNode) {
    const identifier = node.firstNamedChild!;
    return DocumentSymbol.create(
        identifier.text,
        identifier.text, // add detail here
        SymbolKind.Function,
        getRange(node), // as per the docs, range should include comments
        getRange(identifier),
        []
    )
}

// add specific detail handler for different variable types.
function createVariableDocumentSymbol(node: SyntaxNode) {
    const parentNode = node.parent!;
    return DocumentSymbol.create(
        node.text,
        parentNode.text, // add detail here
        SymbolKind.Variable,
        getRange(parentNode), // as per the docs, range should include comments
        getRange(node),
        []
    )
}


function collapseToSymbolsRecursive(node: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    if (isFunctionDefinition(node)) {
        const symbol = createFunctionDocumentSymbol(node);
        node.children.forEach((child) => {
            const childSymbols = collapseToSymbolsRecursive(child);
            if (!symbol.children) symbol.children = [];
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(node)) {
        const symbol = createVariableDocumentSymbol(node);
        symbols.push(symbol);
    } else {
        node.children.forEach((child) => {
            symbols.push(...collapseToSymbolsRecursive(child));
        })
    }
    return symbols;
}



/**
 * Shows the workspace heirarcharal symbols, in a tree format in the client. Unlike
 * collapseToSymbolsRecursive(), this function removes duplicate identifiers in the same
 * scope, and only ends up storing the last refrence.
 *
 * @param {SyntaxNode} root - The root node of the syntax tree.
 *
 * @returns {DocumentSymbol[]} - The document symbols, without duplicates in the same scope.
 */
function toClientTree(root: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(root);
    const seenSymbols: Set<string> = new Set();
    const result: DocumentSymbol[] = [];

    for (const symbol of symbols) {
        const node = getNodeAtRange(root, symbol.range);
        let parent = node!.parent;
        while (parent) {
            if (isScope(parent)) {
                if (!seenSymbols.has(symbol.name)) {
                    seenSymbols.add(symbol.name);
                    result.push(symbol);
                }
                break;
            }
            parent = parent.parent;
        }
    }
    return result;
}

