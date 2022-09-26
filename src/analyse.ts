import {CompletionItem, Connection, Hover, TextDocumentPositionParams} from 'vscode-languageserver';
import {TextDocument} from 'vscode-languageserver-textdocument';
import Parser, {SyntaxNode, Point, Range, Tree} from 'web-tree-sitter';
import {documentationHoverCommandArg, documentationHoverProvider, enrichToCodeBlockMarkdown} from './documentation';
import {Context} from './interfaces';
import {CompletionArguments, generateCompletionArguments} from './utils/exec';
import {getAllFishLocations} from './utils/locations';
import {findParentCommand, isCommand, isFunctionDefinintion, isVariable, isVariableDefintion} from './utils/node-types';
import {findNodeAt, getNodes, getNodeText, getRange} from './utils/tree-sitter';

export class MyAnalyzer {

    private parser: Parser;
    private uriToSyntaxTree: { [uri: string]: SyntaxTree}
    private globalDocs: { [uri: string]: Hover}
    private completions: { [uri: string]: CompletionArguments }

    constructor(parser: Parser) {
        this.parser = parser;
        this.uriToSyntaxTree = {};
        this.globalDocs = {};
        this.completions = {};
    }

    async analyze(document: TextDocument) {

        if (!this.uriToSyntaxTree[document.uri]) {
            this.uriToSyntaxTree[document.uri] = generateInitialSyntaxTree(this.parser, document.getText());
        }
        this.uriToSyntaxTree[document.uri].ensureAnalyzed()

        const uniqCommands = 
            this.uriToSyntaxTree[document.uri]
            .getUniqueCommands()
            .filter((cmd: string) => this.globalDocs[cmd] === undefined)

        for (const cmd of uniqCommands) {
            const docs = await documentationHoverProvider(cmd) 
            const cmps = await generateCompletionArguments(cmd)
            if (docs) this.globalDocs[cmd] = docs;
            if (cmps) this.completions[cmd] = cmps;
        }
    }

    async complete(params: TextDocumentPositionParams) {
        const uri = params.textDocument.uri;
        const tree = this.uriToSyntaxTree[uri]
        const node = this.nodeAtPoint(params)
        const text = this.wordAtPoint(params)
        if (!node || !text) {
            return
        }
        const cmd = findParentCommand(node);

    }

    nodeAtPoint(params: TextDocumentPositionParams) {
        const uri = params.textDocument.uri;
        if (!this.uriToSyntaxTree[uri]) {
            return;
        }
        const currentTree = this.uriToSyntaxTree[uri]
        const node = findNodeAt(currentTree.tree, params.position.line, params.position.character)
        if (!node || node.text.trim() == '') {
            return;
        }
        return node;
    }

    wordAtPoint(params: TextDocumentPositionParams) {
        const node = this.nodeAtPoint(params)
        if (!node) {
            return
        }
        return getNodeText(node);
    }


    getHover(params: TextDocumentPositionParams) : Hover | void{
        const uri = params.textDocument.uri;
        const tree = this.uriToSyntaxTree[uri]
        const node = this.nodeAtPoint(params)
        const text = this.wordAtPoint(params)
        if (!node || !text) {
            return
        }
        if (this.globalDocs[text]) return this.globalDocs[text]

        const cmdNode = findParentCommand(node);
        const localFunction = tree.functions.filter(n => ( node == n ) || (cmdNode == n))[0]
        const cmdText = getNodeText(cmdNode)

        if (localFunction) return {contents: enrichToCodeBlockMarkdown(localFunction.text)}
        if (cmdNode && this.completions[cmdText]) return documentationHoverCommandArg(cmdNode, this.completions[cmdText])
        return
    }

}

function generateInitialSyntaxTree(parser: Parser, text: string) {
    const tree = parser.parse(text);
    return new SyntaxTree(tree);
}


function difference(oldArray: any[], newArray: any[]) {
    return newArray.filter(node => !oldArray.includes(node))
}

export class SyntaxTree {

    public rootNode: SyntaxNode;
    public tree: Tree;
    public nodes: SyntaxNode[] = [];
    public functions: SyntaxNode[] = [];
    public commands: SyntaxNode[] = [];
    public variable_defintions: SyntaxNode[] = [];
    public variables: SyntaxNode[] = [];

    constructor(tree: Tree) {
        this.rootNode = tree.rootNode;
        this.tree = tree;
        this.clearAll();
        this.ensureAnalyzed();
    }

    public ensureAnalyzed() {
        const newNodes = difference(this.nodes, getNodes(this.rootNode));
        this.functions.push(...newNodes.filter(node => isFunctionDefinintion(node)));
        this.commands.push(...newNodes.filter(node => isCommand(node)));
        this.variables.push(...newNodes.filter(node => isVariable(node)))
        this.variable_defintions.push(...newNodes.filter(node => isVariableDefintion(node)));
        return newNodes;
    }

    public clearAll() {
        this.nodes = [];
        this.functions = [];
        this.variables = [];
        this.variable_defintions = [];
        this.commands = [];
    }

    public getUniqueCommands() : string[] {
        return [
            ...
            new Set(
                this.commands
                .map((node: SyntaxNode) => node?.firstChild?.text.trim() || "")
                .filter(nodeStr => nodeStr != "")
            )
        ];
    }

    public getNodeRanges() {
        return this.nodes.map(node => getRange(node))
    }

    public hasRoot() : boolean {
        return this.rootNode != null
    }

    public getNodes() {
        this.ensureAnalyzed()
        return this.nodes;
    }

}
