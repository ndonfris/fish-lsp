import {doc} from 'prettier';
import {
    CompletionItem,
    Connection,
    DocumentUri,
    Hover,
    Location,
    RemoteConsole,
    TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import {
    documentationHoverCommandArg,
    documentationHoverProvider,
    enrichToCodeBlockMarkdown,
    HoverFromCompletion,
} from "./documentation";
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
    isRegexArgument,
    isQuoteString,
    isError,
} from "./utils/node-types";
import {
    descendantMatch,
    findNodeAt,
    getChildNodes,
    getNodeText,
    getRange,
} from "./utils/tree-sitter";
import {URI} from 'vscode-uri';
import {getRangeFromPosition} from './document';

export class Analyzer {
    private parser: Parser;
    //private rootMap: Map<string, >

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };

    // to log local output
    //private console: RemoteConsole | undefined;

    constructor(parser: Parser) {
        this.parser = parser;
        //this.console = console || undefined;
        this.uriTree = {};
    }

    ///**
    // * @async initialize() - intializes a SyntaxTree on context.trees[document.uri]
    // *
    // * @param {Context} context - context of lsp
    // * @param {TextDocument} document - an initialized TextDocument from createTextDocumentFromFilePath()
    // * @returns {Promise<SyntaxTree>} - SyntaxTree which is also stored on context.trees[uri]
    // */
    //public async initialize(document: TextDocument) {
    //    //const document = await createTextDocumentFromFilePath(uri)
    //    const tree = this.parser.parse(document.getText())
    //    this.uriTree[document.uri] = tree;
    //}

    public analyze(document: TextDocument) {
        //delete this.uriTree[document.uri];
        //if (this.uriTree[document.uri] === undefined) {
            //const tree = this.parser.parse(document.getText())
            //this.uriTree[document.uri] = tree;
        //} else {
        //}
        this.parser.reset();
        const tree = this.parser.parse(document.getText())
        this.uriTree[document.uri] = tree;
        //this.uriTree[document.uri] = this.parser.parse(document.getText());
    }

    getRoot(uri: string) {
        return this.uriTree[uri].rootNode
    }

    getLocalNodes(document: TextDocument) {
        const root = this.uriTree[document.uri].rootNode;
        const allNodes = getChildNodes(root);
        return allNodes.filter(node => {
            return isFunctionDefinintion(node) || isVariableDefintion(node)
        })
    }

    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @returns {string} the current line in the document, or an empty string 
     */
    public currentLine(
        document: TextDocument,
        position: Position
    ): TextDocument {
        const currDoc = document.uri;
        const currRange = getRangeFromPosition(position);
        if (currDoc === undefined) return this.blockToDocument('') 
        const currText = document.getText(currRange)
        const currDocument = this.blockToDocument(currText)
        return currDocument;
    }

    public blockToDocument(textBlock: string) {
        return TextDocument.create('current-document', "fish", 0, textBlock);
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

    public isStringRegex(
        uri: string,
        line: number,
        column: number
    ): boolean {
        const node = this.boundaryCheckNode(uri, line, column)
        if (!node) {
            return false;
        }
        const cmdNode = findParentCommand(node);
        if (!cmdNode) {
            return false;
        }
        return cmdNode?.child(0)?.text == "string" && descendantMatch(cmdNode, child => isRegexArgument(child)).length > 0
    }

    //public async getHover(tree: SyntaxTree, params: TextDocumentPositionParams): Promise<Hover | void> {
    //    const uri = params.textDocument.uri;
    //    const line = params.position.line;
    //    const character = params.position.character;

    //    const node = this.nodeAtPoint(tree,line,character)
    //    const text = this.wordAtPoint(tree,line,character)
    //    if (!node || !text) return;

    //    const docs = await documentationHoverProvider(text);
    //    if (docs) {
    //        return docs;
    //    }
    //    return await this.getHoverFallback(node)
    //}

    //public async getHoverFallback(currentNode: SyntaxNode): Promise<Hover | void> {
    //    const cmdNode = findParentCommand(currentNode);
    //    if (!cmdNode) return
    //    const hoverCmp = new HoverFromCompletion(cmdNode, currentNode)
    //    let hover : Hover | void;
    //    if (currentNode.text.startsWith("-")) {
    //        hover = await hoverCmp.generateForFlags()
    //    } else {
    //        hover = await hoverCmp.generate() 
    //    }
    //    if (hover) return hover;
    //    //if (currentNode.text.startsWith('-')) {
    //    //}
    //    return 
    //}

    /**
     * Find the node at the given point.
     */
    public nodeAtPoint(
        uri: string,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {
        const tree = this.uriTree[uri]

        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {
            return null;
        }

        //const node = tree.rootNode.descendantForPosition({row: line, column})
        //if (node.type === "ERROR") {
        //}
        return tree.rootNode.descendantForPosition({ row: line, column });
    }

    public namedNodeAtPoint(
        uri: string,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {
        const tree = this.uriTree[uri]

        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {
            return null;
        }
        return tree.rootNode.namedDescendantForPosition({ row: line, column });
    }

    public findCommandNodeAtPoint(document: TextDocument, line: number, column: number): SyntaxNode | null {
        const node = this.nodeAtPoint(document.uri, line, column);
        if (!node) return null;
        if (isError(node) || isError(node.parent)) {
            let newCol = column - 1;
            let currentTree = removeLastToken(this.parser, this.currentLine(document, { line, character: newCol }))
            while (newCol > 0) {
                const currentNode = findNodeAt(currentTree, line, newCol);
                const newDoc = this.currentLine(document, { line, character: newCol })
                const shortendDoc = removeLastToken(this.parser, newDoc)
                const newDocCurrLine = shortendDoc.rootNode
                //const newDocRoot = this.parser.parse(this.currentLine(document, { line, character: newCol }).getText())
                const newNode = findNodeAt(shortendDoc, line, newCol)
                if (newNode) {
                    const parentCommand = findParentCommand(newNode);
                    if (parentCommand) {
                        return parentCommand;
                    }
                }
                newCol--;
            }
            return null;
        }  
        //if (node.type)
        return findParentCommand(node);
    }

    public boundaryCheckNode(
        uri: string,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {
        const tree = this.uriTree[uri]

        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {
            return null;
        } 
        let currColumn = column;
        while (currColumn > 0) {
            let currNode = this.nodeAtPoint(uri, line, currColumn)
            if (currNode != null) {
               return currNode; 
            }
            currColumn--;
        }
        return null

    }

    /**
     * Find the full word at the given point.
     */
    public wordAtPoint(
        uri: string,
        line: number,
        column: number
    ) : string | null {
        const tree = this.uriTree[uri]
        const node = this.nodeAtPoint(uri, line, column);

        if (!node || node.childCount > 0 || node.text.trim() === "") {
            return null;
        }

        return node.text.trim();
    }

}

function removeLastToken(parser: Parser, document: TextDocument) {
    const str = document.getText();
    const tokenArr = str.split(" ");
    tokenArr.pop();
    return parser.parse(tokenArr.join(" "));
}


function firstNodeBeforeSecondNodeComaprision(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode
) {
    return (
        firstNode.startPosition.row < secondNode.startPosition.row &&
            firstNode.text == secondNode.text
        //firstNode.startPosition.column < secondNode.startPosition.column &&
    );
}

//function difference(oldArray: any[], newArray: any[]) {
//    return newArray.filter((node) => !oldArray.includes(node));
//}

/** 
 * SyntaxTree is necessary because the parse will retrieve node at the given position
 * with type of word, this instead stores from top down, so we get node types of:
 * command, function, variable, variable_definition, etc.
 * Think of better data-structure though and provide method to get completionItems 
 */
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
        this.clearAll();
        this.ensureAnalyzed();
    }

    public ensureAnalyzed() {
        this.clearAll()
        const newNodes = getChildNodes(this.rootNode)
        for (const newNode of getChildNodes(this.rootNode)) {
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
        for (const func of getChildNodes(this.rootNode)) {
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
            ...getChildNodes(functionScope),
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
            ...getChildNodes(this.rootNode)
                .filter(n => !hasParentFunction(n))
        ].filter(n => n.type != 'program')
        return allNodes
    }
}
