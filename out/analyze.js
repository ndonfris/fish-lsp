"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntaxTree = exports.Analyzer = void 0;
const documentation_1 = require("./documentation");
const node_types_1 = require("./utils/node-types");
const tree_sitter_1 = require("./utils/tree-sitter");
class Analyzer {
    constructor(parser) {
        this.parser = parser;
    }
    /**
     * @async initialize() - intializes a SyntaxTree on context.trees[document.uri]
     *
     * @param {Context} context - context of lsp
     * @param {TextDocument} document - an initialized TextDocument from createTextDocumentFromFilePath()
     * @returns {Promise<SyntaxTree>} - SyntaxTree which is also stored on context.trees[uri]
     */
    initialize(context, document) {
        return __awaiter(this, void 0, void 0, function* () {
            //const document = await createTextDocumentFromFilePath(uri)
            const tree = context.parser.parse(document.getText());
            context.trees[document.uri] = new SyntaxTree(tree);
            return context.trees[document.uri];
        });
    }
    analyze(context, document) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!document)
                return undefined;
            const tree = context.parser.parse(document.getText());
            context.trees[document.uri] = new SyntaxTree(tree);
        });
    }
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(tree, line, column) {
        // Check for lacking rootNode (due to failed parse?)
        if (!(tree === null || tree === void 0 ? void 0 : tree.rootNode)) {
            return null;
        }
        return tree.rootNode.descendantForPosition({ row: line, column });
    }
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(tree, line, column) {
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
    currentLine(context, uri, line) {
        const currDoc = context.documents.get(uri);
        if (currDoc === undefined)
            return "";
        const currText = currDoc.getText().split('\n').at(line);
        return currText || "";
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
    getHover(tree, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const line = params.position.line;
            const character = params.position.character;
            const node = this.nodeAtPoint(tree, line, character);
            const text = this.wordAtPoint(tree, line, character);
            if (!node || !text)
                return;
            const docs = yield (0, documentation_1.documentationHoverProvider)(text);
            if (docs) {
                return docs;
            }
            return yield this.getHoverFallback(node);
        });
    }
    getHoverFallback(currentNode) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmdNode = (0, node_types_1.findParentCommand)(currentNode);
            if (!cmdNode)
                return;
            const hoverCmp = new documentation_1.HoverFromCompletion(cmdNode, currentNode);
            let hover;
            if (currentNode.text.startsWith("-")) {
                hover = yield hoverCmp.generateForFlags();
            }
            else {
                hover = yield hoverCmp.generate();
            }
            if (hover)
                return hover;
            //if (currentNode.text.startsWith('-')) {
            //}
            return;
        });
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
        const newNodes = (0, tree_sitter_1.getNodes)(this.rootNode);
        for (const newNode of (0, tree_sitter_1.getNodes)(this.rootNode)) {
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
        for (const func of (0, tree_sitter_1.getNodes)(this.rootNode)) {
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
            ...(0, tree_sitter_1.getNodes)(functionScope),
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
            ...(0, tree_sitter_1.getNodes)(this.rootNode)
                .filter(n => !(0, node_types_1.hasParentFunction)(n))
        ].filter(n => n.type != 'program');
        return allNodes;
    }
}
exports.SyntaxTree = SyntaxTree;
//# sourceMappingURL=analyze.js.map