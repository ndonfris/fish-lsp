import { resolveLspDocumentForHelperTestFile } from "./helpers";
import { TextDocument } from "vscode-languageserver-textdocument";
import {CompletionItem,CompletionParams,DocumentSymbol,MarkupContent,MarkupKind,Position,Range,SymbolKind,TextDocumentIdentifier,} from "vscode-languageserver";
import {BUILT_INS,createCompletionList,generateShellCompletionItems,getShellCompletions,workspaceSymbolToCompletionItem,} from "../src/completion";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { resolve } from "dns";
import { LspDocument } from "../src/document";
import {containsRange,createSymbol,getDefinitionSymbols,getNearbySymbols,getNodeFromRange, getNodeFromSymbol,} from "../src/workspace-symbol";
import {getChildNodes,getNodeAtRange,getRange,getRangeWithPrecedingComments } from "../src/utils/tree-sitter";
import { Color } from "colors";
import { Analyzer } from "../src/analyze";
import {isFunctionDefinition,isFunctionDefinitionName,isDefinition,isVariableDefinition,isScope, findParentCommand,} from "../src/utils/node-types";
import { collectAllSymbolInformation, CommentRange } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";

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
        //const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/multiple_functions.fish");
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/history.fish");
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
        const search1 = root.descendantForPosition({row: 1, column: 8})
        const search2 = root.descendantForPosition({row: 18, column: 18})
        //const def1 = pruneClientTree(root, search)
        //console.log(JSON.stringify({def: def1}, null, 2))
        const funcSymbols = collapseToSymbolsRecursive(root).filter(doc => doc.kind === SymbolKind.Function)
        const flattend = flattendClientTree(root)
        const allDefNodes = flattend.map(symbol => getNodeFromSymbol(root, symbol))
        
        //flattend.forEach((symbol, index) => {
            //console.log(`${index}: ${symbol.detail}`);
        //})
        console.log();
        allDefNodes.forEach((symbol, index) => {
            //console.log(`${index}: ${symbol.text}`);
            const scope = DefinitionSyntaxNode.getScope(symbol)
            console.log(`${index}: ${symbol.text} ${scope}`);
            //console.log((DefinitionSyntaxNode.hasCommand(symbol)));
        })
        //getChildNodes(root).forEach((node, index) => {
            //console.log(`${index}: ${node.text}`);
            //console.log({hasCommand: (DefinitionSyntaxNode.hasCommand(node)), hasScope: DefinitionSyntaxNode.hasScope(node), getScope: DefinitionSyntaxNode.getScope(node)
            //})
        //})
        const cmds = ['read', 'set', 'function', 'for']

        console.log(DefinitionSyntaxNode._flagsMap);
        console.log(DefinitionSyntaxNode._flagsMap.keys());
        console.log(Object.entries(DefinitionSyntaxNode._flagsMap.values()));
        //const cmdMap = DefinitionSyntaxNode.ScopeFlagMap
        //console.log(DefinitionSyntaxNode.hasCommand(allDefNodes[-1]));
        //console.log(DefinitionSyntaxNode.hasCommand(allDefNodes.at(-1)!));
        //console.log(cmdMap.getScope('read', '-l'))
        //console.log(Object.entries(VariableSyntaxNode.CommandFlagMap.map))
    

        //cmds.forEach(cmd => {
            //console.log(VariableSyntaxNode.commandFlagMap[cmd]);
        //})

        //console.log(search1.text);
        //const def2 = findMostRecentDefinition(root, search2)
        //console.log(JSON.stringify({funcSymbols}, null, 2))
        //console.log();
        //console.log(search2.text);
        //console.log(search2.startPosition.row);

        //expect(tree.length).toBe(1);
        //console.log(JSON.stringify({tree},null,2));//const result = await analyzer.getDefinition(doc, toFind[0])
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
    const commentRange = CommentRange.create(identifier);
    return DocumentSymbol.create(
        identifier.text,
        commentRange.markdown().value, // add detail here
        SymbolKind.Function,
        commentRange.toFoldRange(), // as per the docs, range should include comments
        getRange(identifier),
        []
    )
}

// add specific detail handler for different variable types.
function createVariableDocumentSymbol(node: SyntaxNode) {
    const parentNode = node.parent!; 
    const commentRange = CommentRange.create(node)
    //getRangeWithPrecedingComments(parentNode)
    
    return DocumentSymbol.create(
        node.text,
        [`*(variable)* **${node.text}**`, '___', '```fish', `${commentRange.text()}`, '```'].join('\n'), // add detail here
        SymbolKind.Variable,
        getRange(parentNode), // as per the docs, range should include comments
        getRange(node),
        []
    )
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
    export type DefinitionScopes = "global" | "function" | "local" | "block"

    export type VariableCommandNames = "set" | "read" | "for" | "function"
    export const _Map = {
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
    export const FlagsMap = new Map(Object.entries(_Map));

    // HERE's what you wanted
    //export const _FlagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => [
        //command,
        //new Map(Object.entries(scopes).map(([scope, flags]) => [scope, flags]))
    //]));
    export const _flagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => {
        return [command, new Map(Object.entries(scopes).map(([scope, flags]) => {
            return [scope, new Set(flags)];
        }))];
    }));

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

    // old
    // export function _getScope(node: SyntaxNode) {
    //     if (isFunctionDefinition(node)) return "function"
    //     const commandNode = findParentCommand(node) || node.parent
    //     const commandName = commandNode?.text.split(' ')[0] || ''
    //     const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
    //     if (!flags || commandName === 'for') return 'local'
    //     for (const [k, v] of FlagsMap.entries()) {
    //         if  (k !== commandName) continue
    //         const [foundScope, _] = Object.entries(v).filter(
    //             ([_, toMatchFlags]) =>
    //                 flags.some((flag) => toMatchFlags.includes(flag))
    //         );
    //         if (!foundScope) continue
    //         return foundScope
    //     }
    //     return 'local'
    // }

    export function getScope(node: SyntaxNode) {
        if (isFunctionDefinition(node)) return "function"
        const commandNode = findParentCommand(node) || node.parent
        const commandName = commandNode?.text.split(' ')[0] || ''
        const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
        if (!flags || commandName === 'for') return 'local'

        const commandScopes = _flagsMap.get(commandName);
        if (!commandScopes) return 'local';

        for (const [scope, flagSet] of commandScopes.entries()) {
            if (flags.some(flag => flagSet.has(flag))) return scope;
        }
        return 'local'
    }

    // @TODO: implement find enclosing scope for a node
    // export findEnClosingScope(node: SyntaxNode) {}


}
