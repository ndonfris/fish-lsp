import { resolveLspDocumentForHelperTestFile, setMarkedterminal } from "./helpers";
import {CompletionItem,CompletionParams,DocumentSymbol,FoldingRange,FoldingRangeKind,MarkupContent,MarkupKind,Position,Range,SymbolKind,TextDocumentIdentifier,} from "vscode-languageserver";
import {BUILT_INS,createCompletionList,generateShellCompletionItems,getShellCompletions,workspaceSymbolToCompletionItem,} from "../src/completion";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { resolve } from "dns";
import { LspDocument } from "../src/document";
import {collapseToSymbolsRecursive, containsRange,DocumentSymbolTree,getDefinitionSymbols,getNearbySymbols,getNodeFromRange, getNodeFromSymbol, toClientTree,} from "../src/workspace-symbol";
import {getChildNodes,getNodeAtRange,getRange,getRangeWithPrecedingComments, positionToPoint } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import {isFunctionDefinition,isFunctionDefinitionName,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop,} from "../src/utils/node-types";
import { collectAllSymbolInformation, CommentRange } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { toFoldingRange } from '../src/utils/translation';
//import { marked } from 'marked';
//import { Chalk } from 'chalk';
//import   TerminalRenderer   from 'marked-terminal';
//import { Marked } from "marked-terminal";
//import { marginBlockEnd:cc}
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
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/simple_function.fish");
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    it("simple variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/set_var.fish");
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    it("simple for variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/for_var.fish");
        const commentRanges = pushCommentRanges(doc);
        expect(commentRanges.length).toBe(1);
    });

    //it("function with variable symbols", async () => {
    //    const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/function_variable_def.fish");
    //    //const commentRanges = pushCommentRanges(doc)
    //    analyzer.analyze(doc);
    //    //const symbols = collectAllSymbolInformation(doc.uri, parser.parse(doc.getText()).rootNode)
    //    const root = parser.parse(doc.getText()).rootNode
    //    const symbols = DocumentSymbolTree(root).all()
    //    expect(true).toBeTruthy()
    //    //const tree = toClientTree(root)
    //    //expect(symbols.length).toBe(1);
    //    //expect(tree.length).toBe(1);
    //});


    it("multiple function hierarchical symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/inner_functions.fish");
        const root = parser.parse(doc.getText()).rootNode
        const search = root.descendantForPosition({row: 13, column: 19})
        const position_1 : Position = Position.create(4, 22);
        const symbols = collapseToSymbolsRecursive(root);
        //const funcSymbols = collapseToSymbolsRecursive(root).filter(doc => doc.kind === SymbolKind.Function)
        const flattend = DocumentSymbolTree(root).all()
        //const allDefNodes = flattend.map(symbol => getNodeFromSymbol(root, symbol))
        
        flattend.forEach((symbol, index) => {
            console.log(`${index}: ${symbol.detail}`);
            //console.log(JSON.stringify({selectionRange: symbol.selectionRange, range: symbol.range}, null, 2));
        })

        console.log();
        //const results = getLastOccurrence(symbols)
        const tree = DocumentSymbolTree(root)

        console.log("\nAST all: ");
        logClientTree(tree.all())

        console.log("\nAST last: ");
        logClientTree(tree.last())
        console.log(`\n${doc.getLineBeforeCursor(position_1)}`)
        console.log("AST nearby: ");
        tree.nearby(position_1).forEach((symbol, index) => {
            console.log(`${index}: ${symbol.name}`);
        })
        console.log();
        console.log("folding Range: ");
        tree.folds().forEach((symbol: FoldingRange, index: number) => {
            console.log(`${index}: ${symbol.collapsedText}`);
        })
    })
});


// small helper to print out the client tree like the editor would tree
function logClientTree(symbols: DocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        console.log("  ".repeat(level) + `${logIcon}${symbol.name}`);
        logClientTree(symbol.children || [], level + 1);
    }
}


// @TODO: Finish and test
export namespace DefinitionSyntaxNode {
    export const ScopeTypesSet = new Set(["global", "function", "local", "block"]);
    export type ScopeTypes = "global" | "function" | "local" | "block";
    export type VariableCommandNames = "set" | "read" | "for" | "function" // FlagsMap.keys()
    const _Map = {
        read: {
            global:   ["-g", '--global'],
            local:    ["-l", "--local"],
            function: ["-f", "--function"],
        },
        set: {
            global:   ["-g", '--global'],
            local:    ["-l", "--local"],
            function: ["-f", "--function"],
        },
        for: {block: [] },
        function: { 
            function: ["-A", "--argument-names", "-v", "--on-variable"],
            global:   ["-V", "--inherit-variable", '-S', '--no-scope-shadowing'],
        },
    }
    /**
     * Map containing the flags, for a command
     * {
     *     "read": => Map(3) {
     *           "global" => Set(2) { "-g", "--global" },
     *           "local" => Set(2) { "-l", "--local" },
     *           "function" => Set(2) { "-f", "--function" }
     *     }
     *     ...
     * }
     * Usage:
     * FlagsMap.keys()                    => Set(4) { "read", "set", "for", "function }
     * FlagsMap.get("read").get("global") => Set(2) { "-g", "--global" }
     * FlagsMap.get("read").get("global").has("-g") => true
     */
    export const FlagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => {
        return [command, new Map(Object.entries(scopes).map(([scope, flags]) => {
            return [scope, new Set(flags)];
        }))];
    }));
    /**
     * Simple helper to check if the parent node is found in our look up FlagMap.keys()
     *
     * @param {SyntaxNode} node - variable or function node 
     * @returns {boolean} true if the parent node is a a key in the FlagMap
     */
    export function hasCommand(node: SyntaxNode): boolean {
        const parent = findParentCommand(node) || node?.parent;
        const commandName = parent?.text.split(' ')[0] || ''
        //console.log({commandName, var: node.text})
        return !!parent && !![...FlagsMap.keys()].includes(commandName)
    }

    export function hasScope(node: SyntaxNode) {
        if (isFunctionDefinition(node)) return true
        return hasCommand(node) && isVariableDefinition(node)
    }

    export function getScope(node: SyntaxNode) {
        if (isFunctionDefinition(node)) return "function"
        const commandNode = findParentCommand(node) || node.parent
        const commandName = commandNode?.text.split(' ')[0] || ''
        const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
        if (!flags || commandName === 'for') return 'local'

        const commandScopes = FlagsMap.get(commandName);
        if (!commandScopes) return 'local';

        for (const [scope, flagSet] of commandScopes.entries()) {
            if (flags.some(flag => flagSet.has(flag))) return scope;
        }
        return 'local'
    }
    export interface EnclosingDefinitionScope {
        encolsingType: "function" | "block" | "local" | "global";
        enclosingText: string;
        enclosingNode: SyntaxNode;
    }
    export function createEnclosingScope(type: ScopeTypes, node: SyntaxNode): EnclosingDefinitionScope {
        let enclosingText = `in \**${type}** scope`
        if (type === 'function') enclosingText = `in \**${type.toString()}** scope`  
        else if (type === 'block' && isForLoop(node)) enclosingText = `in \**${type.toString()}** \*for_loop* scope`  
        return {encolsingType: type, enclosingText, enclosingNode: node}
    } 

    // @TODO: implement find enclosing scope for a node
    export function getEnclosingScope(node: SyntaxNode) : EnclosingDefinitionScope {
        if (isFunctionDefinition(node)) return createEnclosingScope("function", node)
        const commandNode = node?.parent?.type === 'for_loop' ? node.parent : findParentCommand(node)
        const commandName = commandNode?.text.split(' ')[0] || ''
        const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
        if (!commandNode) return createEnclosingScope('local', node)
        if (commandName === 'for') return createEnclosingScope("block", commandNode)

        const commandScopes = FlagsMap.get(commandName);
        if (!flags.length || !commandScopes) return createEnclosingScope('local', commandNode)

        for (const [scope, flagSet] of commandScopes.entries()) {
            if (flags.some(flag => flagSet.has(flag))) return createEnclosingScope(scope.toString() as ScopeTypes, commandNode);
        }
        return createEnclosingScope('local', commandNode)
    }

}
