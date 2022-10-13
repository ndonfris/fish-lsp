import {doc} from 'prettier';
import {
    CompletionItem,
    Connection,
    DocumentUri,
    Hover,
    Location,
    TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import {
    documentationHoverCommandArg,
    documentationHoverProvider,
    enrichToCodeBlockMarkdown,
    HoverFromCompletion,
} from "./documentation";
import {Context} from './interfaces';
import {
    CompletionArguments,
    execFindDependency,
    generateCompletionArguments,
} from "./utils/exec";
import {createTextDocumentFromFilePath} from './utils/io';
import { getAllFishLocations } from "./utils/locations";
import {
    findDefinedVariable,
    findLastVariableRefrence,
    findParentCommand,
    findFunctionScope,
    isCommand,
    isFunctionDefinintion,
    isVariable,
    isVariableDefintion,
    hasParentFunction,
    isStatement,
} from "./utils/node-types";
import {
    findNodeAt,
    getNodes,
    getNodeText,
    getRange,
} from "./utils/tree-sitter";

export class Analyzer {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    /**
     * @async initialize() - intializes a SyntaxTree on context.trees[document.uri]
     *
     * @param {Context} context - context of lsp
     * @param {TextDocument} document - an initialized TextDocument from createTextDocumentFromFilePath()
     * @returns {Promise<SyntaxTree>} - SyntaxTree which is also stored on context.trees[uri]
     */
    public async initialize(context: Context, document: TextDocument): Promise<SyntaxTree> {
        //const document = await createTextDocumentFromFilePath(uri)
        const tree = context.parser.parse(document.getText())
        context.trees[document.uri] = new SyntaxTree(tree) 
        return context.trees[document.uri]
    }

    public async analyze(context: Context, document: TextDocument) {
        if (!document) return undefined
        const tree = context.parser.parse(document.getText())
        context.trees[document.uri] = new SyntaxTree(tree) 
    }

    /**
     * Find the node at the given point.
     */
    public nodeAtPoint(
        tree: SyntaxTree,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {

        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {
            return null;
        }

        return tree.rootNode.descendantForPosition({ row: line, column });
    }

    /**
     * Find the full word at the given point.
     */
    public wordAtPoint(
        tree: SyntaxTree,
        line: number,
        column: number
    ) : string | null {
        const node = this.nodeAtPoint(tree, line, column);

        if (!node || node.childCount > 0 || node.text.trim() === "") {
            return null;
        }

        return node.text.trim();
    }

    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @param {Context} context - lsp context
     * @param {string} uri - DocumentUri
     * @param {number} line - the line number from from a Position object
     * @returns {string} the current line in the document, or an empty string 
     */
    public currentLine(
        context: Context,
        uri: string,
        line: number
    ): string {
        const currDoc = context.documents.get(uri)
        if (currDoc === undefined) return ""
        const currText = currDoc.getText().split('\n').at(line)
        return currText || "";

    }


    public nodeIsLocal(tree: SyntaxTree, node: SyntaxNode): Hover | void {
        if (!tree) return;

        const result = tree.getLocalFunctionDefinition(node) || tree.getNearestVariableDefinition(node)
        if (!result) return
        return {
            contents: enrichToCodeBlockMarkdown(result.text, 'fish'),
            range: getRange(result),
        };
    }

    public async getHover(tree: SyntaxTree, params: TextDocumentPositionParams): Promise<Hover | void> {
        const uri = params.textDocument.uri;
        const line = params.position.line;
        const character = params.position.character;

        const node = this.nodeAtPoint(tree,line,character)
        const text = this.wordAtPoint(tree,line,character)
        if (!node || !text) return;

        const docs = await documentationHoverProvider(text);
        if (docs) {
            return docs;
        }
        return await this.getHoverFallback(node)
    }

    public async getHoverFallback(currentNode: SyntaxNode): Promise<Hover | void> {
        const cmdNode = findParentCommand(currentNode);
        if (!cmdNode) return
        const hoverCmp = new HoverFromCompletion(cmdNode, currentNode)
        let hover : Hover | void;
        if (currentNode.text.startsWith("-")) {
            hover = await hoverCmp.generateForFlags()
        } else {
            hover = await hoverCmp.generate() 
        }
        if (hover) return hover;
        //if (currentNode.text.startsWith('-')) {
        //}
        return 
    }

}


function firstNodeBeforeSecondNodeComaprision(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode
) {
    return (
        firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.startPosition.column < secondNode.startPosition.column &&
        firstNode.text == secondNode.text
    );
}

//function difference(oldArray: any[], newArray: any[]) {
//    return newArray.filter((node) => !oldArray.includes(node));
//}

export class SyntaxTree {
    public rootNode: SyntaxNode;
    public tree: Tree;
    public nodes: SyntaxNode[] = [];
    public functions: SyntaxNode[] = [];
    public commands: SyntaxNode[] = [];
    public variable_definitions: SyntaxNode[] = [];
    public variables: SyntaxNode[] = [];
    public statements: SyntaxNode[] = [];
    public locations: Location[] = [] ;

    constructor(tree: Parser.Tree) {
        this.tree = tree;
        this.rootNode = this.tree.rootNode;
        this.tree = this.tree;
        this.clearAll();
        this.ensureAnalyzed();
    }

    public ensureAnalyzed() {
        this.clearAll()
        const newNodes = getNodes(this.rootNode)
        for (const newNode of getNodes(this.rootNode)) {
            if (isCommand(newNode)) {
                this.commands.push(newNode)
            }
            if (isFunctionDefinintion(newNode)) {
                this.functions.push(newNode)
            }
            if (isVariable(newNode)) {
                this.variables.push(newNode)
            }
            if (isVariableDefintion(newNode)) {
                this.variable_definitions.push(newNode)
            }
            if (isStatement(newNode)) {
                this.statements.push(newNode)
            }
        }
        //this.commands = [...newNodes.filter((node) => isCommand(node))];
        //this.functions = [
        //    ...newNodes.filter((node) => isFunctionDefinintion(node))
        //]
        //this.variables = [...newNodes.filter((node) => isVariable(node))];
        //this.variable_defintions = [
        //    ...newNodes.filter((node) => isVariableDefintion(node))
        //]
        return newNodes;
    }

    public clearAll() {
        this.functions = [];
        this.variables = [];
        this.variable_definitions = [];
        this.commands = [];
    }

    public getUniqueCommands(): string[] {
        return [
            ...new Set(
                this.commands
                    .map((node: SyntaxNode) => node?.firstChild?.text.trim() || "")
                    .filter((nodeStr) => nodeStr != "")
            ),
        ];
    }

    public getNodeRanges() {
        return this.nodes.map((node) => getRange(node));
    }

    public hasRoot(): boolean {
        return this.rootNode != null;
    }

    public getNodes() {
        this.ensureAnalyzed();
        return this.nodes;
    }

    public getLocalFunctionDefinition(searchNode: SyntaxNode) {
        for (const func of getNodes(this.rootNode)) {
            if (isFunctionDefinintion(func) && func.children[1]?.text == searchNode.text) {
                return func
            }
        }
        return undefined

    }

    // techincally this is nearest variable refrence that is a definition
    public getNearestVariableDefinition(searchNode: SyntaxNode) {
        if (!isVariable(searchNode)) return undefined
        const varaibleDefinitions: SyntaxNode[] = [];
        const functionScope = findFunctionScope(searchNode) 
        const scopedVariableLocations: SyntaxNode[] = [
            ...getNodes(functionScope),
            ...this.getOutmostScopedNodes()
        ]
        for (const node of scopedVariableLocations) {
            if (isVariableDefintion(node) && firstNodeBeforeSecondNodeComaprision(node, searchNode)) {
                const v = findDefinedVariable(node);
                if (!v || !v?.parent) continue;
                varaibleDefinitions.push(v);
            }
        }
        const result = varaibleDefinitions.pop()
        if (!result || !result.parent) return undefined
        return result.parent
    }

    // global nodes are nodes that are not defined in a function
    // (i.e. stuff in config.fish)
    public getOutmostScopedNodes() {
        const allNodes = [ 
            ...getNodes(this.rootNode)
                .filter(n => !hasParentFunction(n))
        ].filter(n => n.type != 'program')
        return allNodes
    }
}
