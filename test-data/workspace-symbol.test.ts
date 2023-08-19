import fs from 'fs'
import os from 'os'
import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,Position,SymbolKind,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer, /*getAllPaths*/ } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop, isVariable, isCommand, isCommandName,} from "../src/utils/node-types";
import { CommentRange, DocumentDefSymbol, symbolKindToString } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
//import { DocumentSymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
import { collectFishWorkspaceSymbols, FishWorkspaceSymbol } from '../src/utils/fishWorkspaceSymbol'
import { pathToRelativeFunctionName, toLspDocument, uriToPath } from '../src/utils/translation';
import * as fastGlob from 'fast-glob'
import { execEscapedCommand } from '../src/utils/exec';
 
let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;

//const chalk = new Chalk();
//const term = new TerminalRenderer()
//marked.setOptions({
    //// Define custom renderer
    //renderer: term,
    //gfm: true,
//});
const jestConsole = console;
//setMarkedterminal();

beforeAll(async () => {
    parser = await initializeParser();
    documentationCache = await initializeDocumentationCache();
    //const allPaths = await getAllPaths()
    //analyzer = new Analyzer(parser, documentationCache, allPaths);
    symbols = [];
})
beforeEach(async () => {
    global.console = require("console");
});

afterEach(() => {
    global.console = jestConsole;
    parser.reset();
});

const logSymbol = (symbol: FishWorkspaceSymbol) => {
    const start = symbol.location.range.start
    const end = symbol.location.range.end
    const text = symbol.documentation.text
    const markdown = symbol.documentation.markdown
    console.log('name: ' + symbol.name);
    console.log('kind: ' + symbol.kind);
    console.log('location: ');
    console.log('\turi: ' + symbol.location.uri);
    console.log('\trange: ' + start.line + ':' + start.character + ' - ' + end.line + ':' + end.character);
    console.log('documentation: ');
    console.log('\tTEXT: \n' + text);
    console.log('\tMARKDOWN: \n' + markdown);
    console.log();
}

const logNode = (node: SyntaxNode | null) => {
    if (node) {
        console.log('text: ' + node.text + '\ntype: ' + node.type);
        console.log();
    } else {
        console.log('node is undefined');
        console.log();
    }
}

//function pushWorkspaceSymbols(doc: LspDocument) {
//    const root: SyntaxNode = parser.parse(doc.getText()).rootNode;
//    const nodes = getChildNodes(root).filter((node) => isDefinition(node));
//    const ws: FishWorkspaceSymbol[] = [];
//    nodes.forEach((node) => {
//        logNode(node)
//        console.log('parent');
//        logNode(node.parent)
//        //commentRanges.push(CommentRange.create(node));
//    });
//    return commentRanges;
//}

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("workspace-symbols tests", () => {
    it("simple function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/simple_function.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = collectFishWorkspaceSymbols(root, doc.uri);
        symbols.forEach(s => {
            logSymbol(s);
        })
        expect(symbols.length).toBe(1);
    });

    //it("simple variable symbols", async () => {
    //    const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/set_var.fish");
    //    const symbols = pushWorkspaceSymbols(doc);
    //    //expect(commentRanges.length).toBe(1);
    //});

    //it("simple for variable symbols", async () => {
    //    const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/for_var.fish");
    //    const symbols = pushWorkspaceSymbols(doc);
    //    //expect(commentRanges.length).toBe(1);
    //});

});


//export async function readAll(analyzer: Analyzer) {
//    for (const filePath of analyzer.allUris) {
//        try {
//            const fileContent = await fs.promises.readFile(filePath, 'utf8')
//            console.log('------------------------------------------------------------------------');
//            console.log(filePath);
//            console.log('------------------------------------------------------------------------');
//            console.log(fileContent.toString())
//            const document = toLspDocument(filePath, fileContent);
//            analyzer.analyze(document);
//        } catch (err) {
//            console.error(err)
//        }
//    }
//}


const checkUriIsAutoloaded = (uri: string) => {
    const paths = [
        `${homedir}/.config/fish/functions`,
        `${homedir}/.config/fish/config.fish`,
        `/usr/share/fish/functions`,
    ]
    return paths.includes(uri)
}


// small helper to print out the client tree like the editor would tree
function logClientTree(symbols: DocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        console.log("  ".repeat(level) + `${logIcon}${symbol.name}`);
        logClientTree(symbol.children || [], level + 1);
    }
}

function logSyntaxNodeArray(nodes: SyntaxNode[]) {
    console.log(`\tnodes array of size ${nodes.length}`);
    nodes.forEach((node, index) => {
        console.log(`node${index}: ${node.text}`);
    })
    console.log('-----------------------------------');
}




