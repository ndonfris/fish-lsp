import {DocumentUri, TextDocument} from 'vscode-languageserver-textdocument';
import {Hover, SymbolKind, TextDocumentPositionParams} from 'vscode-languageserver';
import Parser, {SyntaxNode, Tree} from 'web-tree-sitter';
import {findDefinedVariable, isCommand, isFunctionDefinintion, isVariable, isVariableDefintion} from './utils/node-types';
import {AstsMap, Context, DocsMap, RootsMap} from './interfaces';
import {getRange, getNodes, findNodeAt, getNodeText} from './utils/tree-sitter';
import {execCommandDocs} from './utils/exec';
import {documentationHoverProvider} from './documentation';
//import { initializeParser } from './parser'


function difference(oldArray: any[], newArray: any[]) {
    return newArray.filter(node => !oldArray.includes(node))
}

export class AstNodes {

    public rootNode: SyntaxNode;
    public nodes: SyntaxNode[] = [];
    public functions: SyntaxNode[] = [];
    public commands: SyntaxNode[] = [];
    public variable_defintions: SyntaxNode[] = [];
    public variables: SyntaxNode[] = [];

    constructor(rootNode: SyntaxNode) {
        this.rootNode = rootNode;
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
            ...new Set(this.commands
            .map((node: SyntaxNode) => node?.firstChild?.text)
            .filter((nodeStr): nodeStr is string => !!nodeStr))
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

function parseRoot(parser: Parser, document: TextDocument) {
    return parser.parse(document.getText()).rootNode;
}


// works for all files because .getUniqueCommands() only returns comamnds
export async function analyze(context: Context, document: TextDocument) {
    if (!context.asts.has(document.uri)) {
        const rootNode = parseRoot(context.parser, document)
        context.asts.set(document.uri, new AstNodes(rootNode));
    }
    const currentNodes = context.asts.get(document.uri)?.getUniqueCommands()
    const uniqNodes: string[] = difference(Array.from(context.docs.keys()), currentNodes)
    uniqNodes.map(async (cmdString: string) => {
        if (context.docs.has(cmdString)) {
            context.docs.get(cmdString)
        } else {
            const docs = await documentationHoverProvider(cmdString)
            docs &&
            context.docs.set(
                cmdString, 
                docs 
            )
        }
    })
    return context
}

export async function getNewDocumentation(context: Context, textDocument: TextDocument) {

}

//export class Analyze {
//
//    private context: Context;
//    private document: TextDocument;
//    private docs: DocsMap;
//    private asts: AstsMap;
//    private roots: RootsMap;
//
//
//    constructor(context: Context, document: TextDocument, docs?: DocsMap) {
//        const initRoot = parseRoot(context.parser, document)
//
//        this.context = context;
//        this.document = document;
//        this.docs = docs || new Map() as DocsMap; 
//        this.roots = new Map().set(document.uri, initRoot) as RootsMap;
//        this.asts = new Map().set(document.uri, new AstNodes(initRoot)) as AstsMap;
//    }
//
//    public async buildNewDocument(currDoc: TextDocumentPositionParams): Promise<null | Hover> {
//        let result = {} as Hover;
//        const currentUri = currDoc.textDocument.uri;
//        const rootNode = parseRoot(this.context.parser, this.context.documents.get(currentUri) as TextDocument)
//        if (!this.roots.has(currentUri)) {
//            this.roots.set(currentUri, rootNode)
//        }
//        const uniqCmds = this.asts.get(currentUri)?.getUniqueCommands() || [];
//        const newCmds = difference(Array.from(this.docs.keys()), uniqCmds);
//        const currNode = findNodeAt(rootNode.tree, currDoc.position.line, currDoc.position.character)
//        if (!currNode) return null;
//        const currText = getNodeText(currNode).trim();
//        if (!newCmds) {
//            return this.docs.get<Hover>(currText) as Hover
//        }
//        newCmds
//            .filter(uniq => !this.docs.has(uniq.toString()) )
//            .map(async (cmd: string) => {
//                const found = await documentationHoverProvider(cmd || '');
//                if (found) this.docs.set(cmd, found);
//            })
//        if (this.docs.has(currText)) {
//            result = this.docs.get(currText) as Hover;
//        }
//        return result;
//    }
//
//
//    public async checkForDocumentation(currDoc: TextDocumentPositionParams) : Promise<Hover | null> {
//        const currentUri = currDoc.textDocument.uri;
//        const currentRoot = this.context.roots.get(currentUri) as SyntaxNode;
//        if (!this.roots.has(currentUri) || !this.asts.has(currentUri)) {
//            await this.buildNewDocument(currDoc);
//        } 
//        if (!currentRoot) return null
//
//        const currentNode = findNodeAt(currentRoot?.tree, currDoc.position.line, currDoc.position.character)
//        const currText = getNodeText(currentNode).trim()
//        //const currentRoot = this.context.roots.get(currentUri);
//        //const currentNode this.asts.get(currentUri)?.
//        if (!currText || currText == "") return null
//        const docs = this.docs.get(currText) as Hover
//
//        if (!docs) return null;
//        return docs;
//    }
//
//
//}









