"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntaxTree = exports.Analyzer = void 0;
const documentation_1 = require("./documentation");
const node_types_1 = require("./utils/node-types");
const tree_sitter_1 = require("./utils/tree-sitter");
const document_1 = require("./document");
class Analyzer {
    // to log local output
    //private console: RemoteConsole | undefined;
    constructor(parser) {
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
    analyze(document) {
        delete this.uriTree[document.uri];
        const tree = this.parser.parse(document.getText());
        this.uriTree[document.uri] = tree;
    }
    getRoot(document) {
        return this.uriTree[document.uri].rootNode;
    }
    getLocalNodes(document) {
        const root = this.uriTree[document.uri].rootNode;
        const allNodes = (0, tree_sitter_1.getChildNodes)(root);
        return allNodes.filter(node => {
            return (0, node_types_1.isFunctionDefinintion)(node) || (0, node_types_1.isVariableDefintion)(node);
        });
    }
    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @returns {string} the current line in the document, or an empty string
     */
    currentLine(document, position) {
        const currDoc = document.uri;
        const currRange = (0, document_1.getRangeFromPosition)(position);
        if (currDoc === undefined)
            return "";
        //const row = position.line;
        //const col = position.character;
        //const currText = document.getText().split('\n').at(row)?.substring(0, col + 1) || "";
        const currText = document.getText(currRange);
        return currText;
    }
    nodeIsLocal(tree, node) {
        if (!tree)
            return;
        const result = tree.getLocalFunctionDefinition(node) || tree.getNearestVariableDefinition(node);
        if (!result)
            return;
        return {
            contents: (0, documentation_1.enrichToCodeBlockMarkdown)(result.text, 'fish'),
            range: (0, tree_sitter_1.getRange)(result),
        };
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
    nodeAtPoint(uri, line, column) {
        const tree = this.uriTree[uri];
        // Check for lacking rootNode (due to failed parse?)
        if (!(tree === null || tree === void 0 ? void 0 : tree.rootNode)) {
            return null;
        }
        return tree.rootNode.descendantForPosition({ row: line, column });
    }
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri, line, column) {
        const tree = this.uriTree[uri];
        const node = this.nodeAtPoint(uri, line, column);
        if (!node || node.childCount > 0 || node.text.trim() === "") {
            return null;
        }
        return node.text.trim();
    }
}
exports.Analyzer = Analyzer;
function firstNodeBeforeSecondNodeComaprision(firstNode, secondNode) {
    return (firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.startPosition.column < secondNode.startPosition.column &&
        firstNode.text == secondNode.text);
}
//function difference(oldArray: any[], newArray: any[]) {
//    return newArray.filter((node) => !oldArray.includes(node));
//}
class SyntaxTree {
    constructor(tree) {
        this.nodes = [];
        this.functions = [];
        this.commands = [];
        this.variable_definitions = [];
        this.variables = [];
        this.statements = [];
        this.locations = [];
        this.tree = tree;
        this.rootNode = this.tree.rootNode;
        this.tree = this.tree;
        this.clearAll();
        this.ensureAnalyzed();
    }
    ensureAnalyzed() {
        this.clearAll();
        const newNodes = (0, tree_sitter_1.getChildNodes)(this.rootNode);
        for (const newNode of (0, tree_sitter_1.getChildNodes)(this.rootNode)) {
            if ((0, node_types_1.isCommand)(newNode)) {
                this.commands.push(newNode);
            }
            if ((0, node_types_1.isFunctionDefinintion)(newNode)) {
                this.functions.push(newNode);
            }
            if ((0, node_types_1.isVariable)(newNode)) {
                this.variables.push(newNode);
            }
            if ((0, node_types_1.isVariableDefintion)(newNode)) {
                this.variable_definitions.push(newNode);
            }
            if ((0, node_types_1.isStatement)(newNode)) {
                this.statements.push(newNode);
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
    clearAll() {
        this.functions = [];
        this.variables = [];
        this.variable_definitions = [];
        this.commands = [];
    }
    getUniqueCommands() {
        return [
            ...new Set(this.commands
                .map((node) => { var _a; return ((_a = node === null || node === void 0 ? void 0 : node.firstChild) === null || _a === void 0 ? void 0 : _a.text.trim()) || ""; })
                .filter((nodeStr) => nodeStr != "")),
        ];
    }
    getNodeRanges() {
        return this.nodes.map((node) => (0, tree_sitter_1.getRange)(node));
    }
    hasRoot() {
        return this.rootNode != null;
    }
    getNodes() {
        this.ensureAnalyzed();
        return this.nodes;
    }
    getLocalFunctionDefinition(searchNode) {
        var _a;
        for (const func of (0, tree_sitter_1.getChildNodes)(this.rootNode)) {
            if ((0, node_types_1.isFunctionDefinintion)(func) && ((_a = func.children[1]) === null || _a === void 0 ? void 0 : _a.text) == searchNode.text) {
                return func;
            }
        }
        return undefined;
    }
    // techincally this is nearest variable refrence that is a definition
    getNearestVariableDefinition(searchNode) {
        if (!(0, node_types_1.isVariable)(searchNode))
            return undefined;
        const varaibleDefinitions = [];
        const functionScope = (0, node_types_1.findFunctionScope)(searchNode);
        const scopedVariableLocations = [
            ...(0, tree_sitter_1.getChildNodes)(functionScope),
            ...this.getOutmostScopedNodes()
        ];
        for (const node of scopedVariableLocations) {
            if ((0, node_types_1.isVariableDefintion)(node) && firstNodeBeforeSecondNodeComaprision(node, searchNode)) {
                const v = (0, node_types_1.findDefinedVariable)(node);
                if (!v || !(v === null || v === void 0 ? void 0 : v.parent))
                    continue;
                varaibleDefinitions.push(v);
            }
        }
        const result = varaibleDefinitions.pop();
        if (!result || !result.parent)
            return undefined;
        return result.parent;
    }
    // global nodes are nodes that are not defined in a function
    // (i.e. stuff in config.fish)
    getOutmostScopedNodes() {
        const allNodes = [
            ...(0, tree_sitter_1.getChildNodes)(this.rootNode)
                .filter(n => !(0, node_types_1.hasParentFunction)(n))
        ].filter(n => n.type != 'program');
        return allNodes;
    }
}
exports.SyntaxTree = SyntaxTree;
//# sourceMappingURL=analyze.js.map