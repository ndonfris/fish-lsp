import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,Position,SymbolKind,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop,} from "../src/utils/node-types";
import { CommentRange, symbolKindToString } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { DocumentSymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
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
    analyzer = new Analyzer(parser, documentationCache);
    symbols = [];
})
beforeEach(async () => {
    global.console = require("console");
});

afterEach(() => {
    global.console = jestConsole;
    parser.reset();
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

    //it("multiple function hierarchical symbols", async () => {
    //    const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/inner_functions.fish");
    //    const root = parser.parse(doc.getText()).rootNode
    //    const search = root.descendantForPosition({row: 13, column: 19})
    //    const position_1 : Position = Position.create(4, 22);
    //    const flattend = DocumentSymbolTree(root).all()
    //    
    //    flattend.forEach((symbol, index) => {
    //        console.log(`${index}: ${symbol.detail}`);
    //    })

    //    console.log();
    //    const tree = DocumentSymbolTree(root)

    //    console.log("\nAST all: ");
    //    logClientTree(tree.all())

    //    console.log("\nAST last: ");
    //    logClientTree(tree.last())
    //    console.log(`\n${doc.getLineBeforeCursor(position_1)}`)
    //    console.log("AST nearby: ");
    //    tree.nearby(position_1).forEach((symbol, index) => {
    //        console.log(`${index}: ${symbol.name}`);
    //    })
    //    console.log();
    //    console.log("folding Range: ");
    //    tree.folds(doc).forEach((symbol: FoldingRange, index: number) => {
    //        console.log(`${index}: ${symbol.collapsedText}`);
    //    })
    //})

    it('getRefrences for a documentSymbol', async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/inner_functions.fish"); 
        const root = parser.parse(doc.getText()).rootNode                                              
        //const normal_1 = root.descendantForPosition({row: 13, column: 15})
        const normal_1 = root.descendantForPosition({row: 19, column: 16})                               
        const for_1 = root.descendantForPosition({row: 22, column: 15})                               
        const tree = DocumentSymbolTree(root);
        const defNode = tree.findDef(normal_1)
        const forNode = tree.findDef(for_1)
        logSyntaxNodeArray(tree.findRefs(normal_1))
        logSyntaxNodeArray(tree.findRefs(for_1))
    })

    it('getRefrences for config.fish', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`${homedir}/.config/fish/config.fish`); 
        //const parser = await initializeParser();
        //const analyzer = new Analyzer(parser, documentationCache);
        //const normal_1 = root.descendantForPosition({row: 13, column: 15})
        //const tree = DocumentSymbolTree().last();
        console.log(JSON.stringify(doc, null, 2));
        analyzer.analyze(doc);
        const root = analyzer.getRootNode(doc)
        const posis = analyzer.parsePosition(doc, Position.create(0, 0));
        console.log(`${posis.root?.toString()}`);
        console.log(`'${posis.currentNode?.text}'`);
        const tree = root && DocumentSymbolTree(root).all()
        if (tree) {
            logClientTree(tree)
        }
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

function logSyntaxNodeArray(nodes: SyntaxNode[]) {
    console.log(`\tnodes array of size ${nodes.length}`);
    nodes.forEach((node, index) => {
        console.log(`node${index}: ${node.text}`);
    })
    console.log('-----------------------------------');
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
