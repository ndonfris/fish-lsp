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
        const toFind = analyzer
            .getNodes(doc)
            .filter((n) => n.text === "simple_function");
        //const symbols = collectAllSymbolInformation(doc.uri, parser.parse(doc.getText()).rootNode)
        const symbols = collapseToSymbolsRecursive(
            parser.parse(doc.getText()).rootNode
        );
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
        console.log(symbols.length);
        //const result = await analyzer.getDefinition(doc, toFind[0])
        //result.forEach(n => {
        //console.log(n);
        //console.log();
        //})
        //console.log(toFind[0]?.text);
        //expect(commentRanges.length).toBe(3);
    });
});

//function collapseToSymbolsRecursive(node: SyntaxNode, parent: DocumentSymbol | null = null): DocumentSymbol[] {
//    let symbols: DocumentSymbol[] = []
//
//    let parentNode: SyntaxNode | null = null;
//    let identifier: SyntaxNode | null = node;
//    const selectionRange = getRange(node);
//
//    if (isFunctionDefinitionName(node)) {
//        parentNode = node.parent!
//        const symbol: DocumentSymbol = {
//            name: identifier?.text!,
//            kind: SymbolKind.Function,
//            range: getRange(parentNode),
//            selectionRange: getRange(identifier),
//            children: []
//        }
//        if(parent) parent.children?.push(symbol);
//        symbols.push(symbol);
//    } else if (isVariableDefinition(node)) {
//        parentNode = node.parent!
//        const symbol: DocumentSymbol = {
//            name: identifier.text,
//            kind: SymbolKind.Variable,
//            range: getRange(parentNode),
//            selectionRange: getRange(identifier),
//            children: []
//        }
//        if(parent) parent.children?.push(symbol);
//        symbols.push(symbol);
//    } else {
//        for (const child of node.children) {
//            symbols = symbols.concat(
//                collapseToSymbolsRecursive(
//                    child,
//                    parent
//                        ? parent
//                        : symbols.find(
//                              (s) =>
//                                  s.range.start.line ===
//                                      selectionRange.start.line &&
//                                  s.range.start.character ===
//                                      selectionRange.start.character
//                          )
//                )
//            );
//        }
//    }
//
//    return symbols
//}

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
    let symbols: DocumentSymbol[] = [];
    let parentNode: SyntaxNode | null = node.parent;
    let identifier: SyntaxNode = node;
    if (isFunctionDefinition(node)) {
        identifier = node.firstNamedChild!;
        const symbol = DocumentSymbol.create(
            identifier.text,
            identifier.text,
            SymbolKind.Function,
            getRange(node),
            getRange(identifier),
            []
        );
        for (const child of node.children) {
            const childSymbols = collapseToSymbolsRecursive(child);
            if (!symbol.children) symbol.children = [];
            symbol.children.push(...childSymbols);
        }
        symbols.push(symbol);
    } else if (isVariableDefinition(node)) {
        parentNode = node.parent!;
        const symbol = DocumentSymbol.create(
            identifier.text,
            identifier.text,
            SymbolKind.Variable,
            getRange(parentNode),
            getRange(identifier),
            []
        );
        symbols.push(symbol);
    } else {
        for (const child of node.children) {
            symbols.push(...collapseToSymbolsRecursive(child));
        }
    }
    return symbols;
}
