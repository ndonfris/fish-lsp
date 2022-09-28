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
exports.SyntaxTree = exports.MyAnalyzer = void 0;
const documentation_1 = require("./documentation");
const exec_1 = require("./utils/exec");
const node_types_1 = require("./utils/node-types");
const tree_sitter_1 = require("./utils/tree-sitter");
class MyAnalyzer {
    constructor(parser) {
        this.parser = parser;
        this.uriToSyntaxTree = {};
        this.globalDocs = {};
        this.completions = {};
        this.dependencies = {};
    }
    initialize(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            this.uriToSyntaxTree[uri] = null;
        });
    }
    analyze(uri, document) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.uriToSyntaxTree[uri]) {
                this.uriToSyntaxTree[uri] = generateInitialSyntaxTree(this.parser, document.getText());
            }
            //this.uriToSyntaxTree[uri]?.ensureAnalyzed()
            const uniqCommands = (_a = this.uriToSyntaxTree[uri]) === null || _a === void 0 ? void 0 : _a.getUniqueCommands().filter((cmd) => this.globalDocs[cmd] === undefined);
            if (!uniqCommands)
                return;
            for (const cmd of uniqCommands) {
                const docs = yield (0, documentation_1.documentationHoverProvider)(cmd);
                //const cmps = await generateCompletionArguments(cmd)
                if (docs)
                    this.globalDocs[cmd] = docs;
                //if (cmps) this.completions[cmd] = cmps;
                if (this.dependencies[cmd] === undefined) {
                    const path = yield (0, exec_1.execFindDependency)(cmd);
                    if (path.trim() != "") {
                        this.dependencies[cmd] = path;
                    }
                }
            }
        });
    }
    complete(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const tree = this.uriToSyntaxTree[uri];
            const node = this.nodeAtPoint(params.textDocument.uri, params.position.line, params.position.character);
            const text = this.wordAtPoint(params.textDocument.uri, params.position.line, params.position.character);
            if (!node || !text) {
                return;
            }
            const cmd = (0, node_types_1.findParentCommand)(node);
        });
    }
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(uri, line, column) {
        const document = this.uriToSyntaxTree[uri];
        if (!(document === null || document === void 0 ? void 0 : document.rootNode)) {
            // Check for lacking rootNode (due to failed parse?)
            return null;
        }
        return document.rootNode.descendantForPosition({ row: line, column });
    }
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri, line, column) {
        const node = this.nodeAtPoint(uri, line, column);
        if (!node || node.childCount > 0 || node.text.trim() === "") {
            return null;
        }
        return node.text.trim();
    }
    nodeIsLocal(uri, node) {
        const tree = this.uriToSyntaxTree[uri];
        if (!tree)
            return;
        tree.ensureAnalyzed();
        const result = tree.getLocalFunctionDefinition(node) || tree.getNearestVariableDefinition(node);
        if (!result)
            return;
        return {
            contents: (0, documentation_1.enrichToCodeBlockMarkdown)(result.text, 'fish'),
            range: (0, tree_sitter_1.getRange)(result),
        };
    }
    getHover(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const line = params.position.line;
            const character = params.position.character;
            const tree = this.uriToSyntaxTree[uri];
            if (!tree) {
                return;
            }
            const node = this.nodeAtPoint(uri, line, character);
            const text = this.wordAtPoint(uri, line, character);
            if (!node || !text) {
                return;
            }
            if (this.globalDocs[text]) {
                return this.globalDocs[text];
            }
            const docs = yield (0, documentation_1.documentationHoverProvider)(text);
            const cmdNode = (0, node_types_1.findParentCommand)(node);
            if (!docs && cmdNode) {
                const cmdDocs = yield (0, documentation_1.documentationHoverProvider)(cmdNode === null || cmdNode === void 0 ? void 0 : cmdNode.text);
                if (cmdDocs) {
                    return cmdDocs;
                }
            }
            if (docs) {
                this.globalDocs[text] = docs;
                return docs;
            }
            return;
        });
    }
    getHoverFallback(uri, currentNode) {
        return __awaiter(this, void 0, void 0, function* () {
            const tree = this.uriToSyntaxTree[uri];
            if (!tree) {
                return;
            }
            const cmdNode = (0, node_types_1.findParentCommand)(currentNode);
            if (!cmdNode)
                return;
            if (currentNode.text.startsWith('-')) {
            }
        });
    }
    getTreeForUri(uri) {
        if (!this.uriToSyntaxTree[uri]) {
            return null;
        }
        return this.uriToSyntaxTree[uri];
    }
}
exports.MyAnalyzer = MyAnalyzer;
function generateInitialSyntaxTree(parser, text) {
    const tree = parser.parse(text);
    return new SyntaxTree(tree);
}
function getDependencies(tree, depMap) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const result = [];
        for (const cmd of tree.commands) {
            const cmdText = ((_a = cmd === null || cmd === void 0 ? void 0 : cmd.firstChild) === null || _a === void 0 ? void 0 : _a.text.trim()) || "";
            if (cmdText && depMap[cmdText] !== undefined) {
                result.push(depMap[cmdText]);
                continue;
            }
            if (cmdText && depMap[cmdText] === undefined) {
                const depUri = yield (0, exec_1.execFindDependency)(cmdText);
                if (!depUri || depUri.trim() == "")
                    continue;
                depMap[cmdText] = depUri;
                result.push(depUri);
            }
        }
        return { localDeps: result, globalDeps: depMap };
    });
}
function firstNodeBeforeSecondNodeComaprision(firstNode, secondNode) {
    return (firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.startPosition.column < secondNode.startPosition.column &&
        firstNode.text == secondNode.text);
}
function difference(oldArray, newArray) {
    return newArray.filter((node) => !oldArray.includes(node));
}
class SyntaxTree {
    constructor(tree) {
        this.nodes = [];
        this.functions = [];
        this.commands = [];
        this.variable_definitions = [];
        this.variables = [];
        this.rootNode = tree.rootNode;
        this.tree = tree;
        this.clearAll();
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
        this.nodes = [];
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
        const funcs = [];
        for (const func of (0, tree_sitter_1.getNodes)(this.rootNode)) {
            if ((0, node_types_1.isFunctionDefinintion)(func) && ((_a = func.children[1]) === null || _a === void 0 ? void 0 : _a.text) == searchNode.text) {
                return func;
            }
        }
        return undefined;
    }
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
        //varaibleDefinitions.filter(
        //    (node: SyntaxNode) =>
        //    firstNodeBeforeSecondNodeComaprision(node, searchNode) 
        //    && node?.parent != null
        //).pop()
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
//# sourceMappingURL=analyse.js.map