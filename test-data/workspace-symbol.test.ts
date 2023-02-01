import fs from 'fs'
import os from 'os'
import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,Position,SymbolKind,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop, isVariable, isCommand, isCommandName,} from "../src/utils/node-types";
import { CommentRange, DocumentDefSymbol, symbolKindToString } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { DocumentSymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
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
        //console.log(`${posis.root?.toString()}`);
        //console.log(`'${posis.currentNode?.text}'`);
        if (!root) return
        for (const node of getChildNodes(root).filter(isDefinition)) {
            const scope = DefinitionSyntaxNode.getScope(node)
            console.log(`scope: ${scope} node: ${node.text}`);
        }
        console.log();
        console.log();
        console.log();
        for (const scopeNode of collectScopes(root, doc.uri)) {
            console.log(`scope: ${scopeNode.text}`);
        }
    })

    it('testing generating WorkspaceSymbols', async () => {
        console.log();
        await readAll(analyzer)
        console.log();
        //console.log(process.env);
    })
});

export async function readAll(analyzer: Analyzer) {
    const allPaths = await getFilePaths({maxItems: 10000});
    for (const filePath of allPaths) {
        try {
            const fileContent = await fs.promises.readFile(filePath, 'utf8')
            console.log('------------------------------------------------------------------------');
            console.log(filePath);
            console.log('------------------------------------------------------------------------');
            console.log(fileContent.toString())
            const document = toLspDocument(filePath, fileContent);
            analyzer.analyze(document);
        } catch (err) {
            console.error(err)
        }
    }
}


export async function getFilePaths({
  //globPattern,
  //rootPath,
  maxItems,
}: {
  //globPattern: string
  //rootPath: string
  maxItems: number
}): Promise<string[]> {
    //const rootPath = uriToPath(rootPath)
    //const paths = await execEscapedCommand('echo $fish_function_path | string split " "')
    //const results: string[] = [];
    const stream = fastGlob.stream(['**.fish'], {
        absolute: true,
        onlyFiles: true,
        cwd: `${homedir}/.config/fish`,
        followSymbolicLinks: true,
        suppressErrors: true,
    })

    // NOTE: we use a stream here to not block the event loop
    // and ensure that we stop reading files if the glob returns
    // too many files.
    const files: string[] = []
    let i = 0
    for await (const fileEntry of stream) {
        if (i >= maxItems) {
            // NOTE: Close the stream to stop reading files paths.
            stream.emit('close')
            break
        }

        files.push(fileEntry.toString())
        i++
    }
    return files
}

const checkUriIsAutoloaded = (uri: string) => {
    const paths = [
        `${homedir}/.config/fish/functions`,
        `${homedir}/.config/fish/config.fish`,
        `/usr/share/fish/functions`,
    ]
    return paths.includes(uri)
}

function collectScopes(root: SyntaxNode, uri: string): SyntaxNode[] {
    const isAutoloaded = checkUriIsAutoloaded(uri)
    const functionName = pathToRelativeFunctionName(uri)
    const scopes: SyntaxNode[] = [];
    const definitionNodes = getChildNodes(root).filter(isDefinition)
    for (const node of definitionNodes) {
        const scope = DefinitionSyntaxNode.getScope(node)
        if (scope === "global") {
            scopes.push(node)
        } else if (scope === "function" && node.text === functionName && isAutoloaded) {
            scopes.push(node)
        } else if (scope === "function" && "config" === functionName && isAutoloaded) {
            scopes.push(node)
        }
    }
    return scopes;
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



//function checkDefinitionScope()



// @TODO: Finish and test
export namespace DefinitionSyntaxNode {
    export const ScopeTypesSet = new Set(["global", "function", "local", "block"]);
    export type ScopeTypes = "global" | "function" | "local" | "block";
    export type VariableCommandNames = "set" | "read" | "for" | "function" // FlagsMap.keys()
    export interface CommandOption {
        short: string[]
        long: string[]
        isDefault: boolean
    }
    export class CommandOption {
        constructor(short: string[], long: string[], isDefault: boolean) {
            this.short = short;
            this.long = long;
            this.isDefault = isDefault;
        }
        has(option: string): boolean {
            if (option.startsWith('--')) {
                const withoutDash = option.slice(2);
                return this.long.includes(withoutDash);
            } else if (option.startsWith('-')) {
                const withoutDash = option.slice(1);
                return this.short.some(opt => withoutDash.split('').includes(opt));
            } else {
                return false;
            }
        }
        toString() {
            return '[' + this.short.map(s => '-'+s).join(', ') + ', ' + this.long.map(l => '--'+l).join(', ') + ']';
            //return returnString;
        }
    }
    const createFlags = (flags: string[], isDefault: boolean = false): CommandOption => {
        return new CommandOption(
            flags.filter((flag) => flag.startsWith("-") && flag.length === 2).map((flag) => flag.slice(1)),
            flags.filter((flag) => flag.startsWith("--")).map((flag) => flag.slice(2)), 
            isDefault
        );
    }
    const _Map = {
        read: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        set: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        for: {
            block: createFlags([]) 
        },
        function: { 
            function: createFlags(["-A", "--argument-names", "-v", "--on-variable"], true)   ,
            global:   createFlags(["-V", "--inherit-variable", '-S', '--no-scope-shadowing']),
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
            return [scope, flags];
        }))];
    }));

    function collectFlags(cmdNode: SyntaxNode): string[] {
        //const flags = [];
        return cmdNode.children.filter(n => n.text.startsWith("-")).map(n => n.text);
        //for (const flag of cmdNode.children.filter(n => n.text.startsWith("-"))) {
            //flags.push(flag?.text);
        //}
        //return flags;
    }

    export const getScope = (definitionNode: SyntaxNode) => {
        if (!isDefinition(definitionNode)) return null;
        const command = findFirstParent(definitionNode, isCommandName) || definitionNode.parent;
        const commandName = command?.firstChild?.text || "";
        if (!command || !commandName) return
        const currentFlags = collectFlags(command)
        //console.log(`command: ${command?.text}`);
        //console.log(`commandName: ${commandName}`);
        //console.log(`flagsSeen: [${currentFlags.join(', ')}]`);
        let saveScope : string = 'local';
        for (const [scope, scopeFlags] of FlagsMap.get(commandName)!.entries()) {
            if (currentFlags.some(flag => scopeFlags.has(flag))) {
                return scope
            } else if (scopeFlags.isDefault) {
                saveScope = scope
            }
        }
        return saveScope
    }
}
