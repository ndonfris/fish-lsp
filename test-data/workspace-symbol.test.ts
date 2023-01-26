import { resolveLspDocumentForHelperTestFile, setMarkedterminal } from "./helpers";
import {CompletionItem,CompletionParams,DocumentSymbol,MarkupContent,MarkupKind,Position,Range,SymbolKind,TextDocumentIdentifier,} from "vscode-languageserver";
import {BUILT_INS,createCompletionList,generateShellCompletionItems,getShellCompletions,workspaceSymbolToCompletionItem,} from "../src/completion";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { resolve } from "dns";
import { LspDocument } from "../src/document";
import {containsRange,createSymbol,getDefinitionSymbols,getNearbySymbols,getNodeFromRange, getNodeFromSymbol,} from "../src/workspace-symbol";
import {getChildNodes,getNodeAtRange,getRange,getRangeWithPrecedingComments } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import {isFunctionDefinition,isFunctionDefinitionName,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop,} from "../src/utils/node-types";
import { collectAllSymbolInformation, CommentRange } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
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

    it("function with variable symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/function_variable_def.fish");
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
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/multiple_functions.fish");
        //const doc = resolveLspDocumentForHelperTestFile("./fish_files/history.fish");
        const root = parser.parse(doc.getText()).rootNode
        const search = root.descendantForPosition({row: 13, column: 19})
        const symbols = collapseToSymbolsRecursive(root);
        //symbols.forEach((symbol, index) => {
            //console.log(symbol.name);
            //console.log(JSON.stringify({ index: index, children: symbol.children },null,2))
        //});
        //expect(symbols.length).toBe(3);
        //console.log("\nLOGGING SCOPES:");
        const tree = toClientTree(root)
        logClientTree(tree)
        //console.log();
        //console.log(search.text);
        //const search1 = root.descendantForPosition({row: 1, column: 8})
        //const search2 = root.descendantForPosition({row: 18, column: 18})
        //const def1 = pruneClientTree(root, search)
        //console.log(JSON.stringify({def: def1}, null, 2))
        const funcSymbols = collapseToSymbolsRecursive(root).filter(doc => doc.kind === SymbolKind.Function)
        const flattend = flattendClientTree(root)
        const allDefNodes = flattend.map(symbol => getNodeFromSymbol(root, symbol))
        
        //flattend.forEach((symbol, index) => {
            //console.log(`${index}: ${symbol.detail}`);
        //})

        console.log();
        flattend.forEach((symbol, index) => {
            //const m = marked(c).toString()
            console.log(`${index.toString()}: ${symbol.name}`);
            console.log(symbol?.detail || "");
            console.log();
        })
        //allDefNodes.forEach((symbol, index) => {
        //    const scope = DefinitionSyntaxNode.getScope(symbol);
        //    console.log(`${index}: ${symbol.text} ${scope}`);
        //})
        //getChildNodes(root).forEach((node, index) => {
            //console.log(`${index}: ${node.text}`);
            //console.log({hasCommand: (DefinitionSyntaxNode.hasCommand(node)), hasScope: DefinitionSyntaxNode.hasScope(node), getScope: DefinitionSyntaxNode.getScope(node)
            //})
        //})
        //console.log(DefinitionSyntaxNode.FlagsMap);

        console.log();
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
    const identifier = node.firstNamedChild || node.firstChild!;
    const commentRange = CommentRange.create(identifier);
    const {  enclosingText, enclosingNode, encolsingType } = DefinitionSyntaxNode.getEnclosingScope(node);
    return DocumentSymbol.create(
        identifier.text,
        commentRange.markdown(), // add detail here
        SymbolKind.Function,
        getRange(node), //commentRange.(), // as per the docs, range should include comments
        getRange(identifier),
        []
    )
}

// add specific detail handler for different variable types.
function createVariableDocumentSymbol(node: SyntaxNode) {
    const parentNode = node.parent!; 
    const commentRange = CommentRange.create(node)
    const withCommentText = isFunctionDefinition(parentNode) ? parentNode.text.toString() : commentRange.text()
    //getRangeWithPrecedingComments(parentNode)
    const {  enclosingText, enclosingNode, encolsingType } = DefinitionSyntaxNode.getEnclosingScope(parentNode);
    return DocumentSymbol.create(
        node.text,
        [ 
            `\*(variable)* \**${node.text}**`,
            'enclosingText:     '+ enclosingText,
            `enclosingNode.text: ${enclosingNode.text}`,
            `enclosingType     : ${encolsingType}`,
            "___",
            "```fish",
            `${withCommentText.trim()}`,
            "```",
        ].join("\n"),
        SymbolKind.Variable,
        getRange(parentNode), // as per the docs, range should include comments
        getRange(node),
        []
    );
}


/**
 * This is the recursive solution to building the document symbols (for definitions).
 *
 * @see createFunctionDocumentSymbol
 * @see createVariableDocumentSymbol
 *
 * @param {SyntaxNode} node - the node to start the recursive search from
 * @returns {DocumentSymbol[]} - the resulting DocumentSymbols, which is a TREE not a flat list
 */
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
        let parent = node?.parent || node;
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

function getNearestDefinition(root: SyntaxNode, searchNode: SyntaxNode): DocumentSymbol | undefined {
    const symbols = collapseToSymbolsRecursive(root);
    let nearestDefinition: DocumentSymbol | undefined;
    for (let i = symbols.length - 1; i >= 0; i--) {
        if (symbols[i].name === searchNode.text && 
            (symbols[i].kind === SymbolKind.Function || 
                (symbols[i].kind === SymbolKind.Variable && symbols[i].range.end <= getRange(searchNode).start))) {
            nearestDefinition = symbols[i];
            break;
        }
    }
    return nearestDefinition;
}

/**
 * gets all the symbols of a depth before the variableNode.
 *
 * `function func_a 
 *     set -l var_b; set -l var_c
 *  end
 *  set -l search_for
 *  echo $search_for `<-- starting here 
 *  would show a pruned tree of:
 *       - `func_a`
 *       - `search_for`
 *  `var_b`, and `var_c` are not reachable and have been pruned
 */
function pruneClientTree(rootNode: SyntaxNode, variableNode: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(rootNode);

    const prunedSymbols: DocumentSymbol[] = []
    let nextSymbols : DocumentSymbol[] = [...symbols]
    let currentNode: SyntaxNode | null = findParentCommand(variableNode);

    while (currentNode && currentNode?.type !== 'program') {
        currentNode = currentNode.parent;
        const currentLevel = [...nextSymbols.filter(n => n !== undefined)];
        prunedSymbols.push(...currentLevel);
        nextSymbols = [];
        currentLevel.forEach(symbol => {
            if (symbol.children) nextSymbols.push(...symbol.children)
        })
    }
    return prunedSymbols;
}

function findMostRecentDefinition(rootNode: SyntaxNode, searchNode: SyntaxNode): DocumentSymbol | undefined {
    const prunedSymbols = pruneClientTree(rootNode, searchNode);
    const recentDefinition = prunedSymbols.filter(symbol => symbol.name === searchNode.text);
    for (const recentlyDefined of recentDefinition.reverse()) {
        if (recentlyDefined.selectionRange.start.line < getRange(searchNode).start.line) {
            return recentlyDefined
        }
    }
    return undefined
}

function flattendClientTree(rootNode: SyntaxNode) : DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(rootNode);
    const stack: DocumentSymbol[] = [...symbols];
    const result: DocumentSymbol[] = [];
    while (stack.length > 0) {
        const symbol = stack.shift();
        if (!symbol) continue;
        result.push(symbol);
        if (symbol.children) stack.unshift(...symbol.children);
    }
    return result;
}



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
    export function hasCommand(node: SyntaxNode){
        const parent = findParentCommand(node) || node?.parent;
        const commandName = parent?.text.split(' ')[0] || ''
        console.log({commandName, var: node.text})
        return parent && [...FlagsMap.keys()].includes(commandName)
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
        //let enclosingText = `in \**${type.toString()}** scope`
        //if (type === 'global') {enclosingText = `in \**${type}** scope`}
        //else if (type === 'local') {enclosingText = `in \**${type}** scope`}
        //else if (type === 'function') {enclosingText = `in \**${type}** scope: \*${node.firstChild}*`}
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
