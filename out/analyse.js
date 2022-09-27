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
    analyze(uri, document) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.uriToSyntaxTree[uri]) {
                this.uriToSyntaxTree[uri] = generateInitialSyntaxTree(this.parser, document.getText());
            }
            this.uriToSyntaxTree[uri].ensureAnalyzed();
            const uniqCommands = this.uriToSyntaxTree[uri]
                .getUniqueCommands()
                .filter((cmd) => this.globalDocs[cmd] === undefined);
            for (const cmd of uniqCommands) {
                const docs = yield (0, documentation_1.documentationHoverProvider)(cmd);
                const cmps = yield (0, exec_1.generateCompletionArguments)(cmd);
                if (docs)
                    this.globalDocs[cmd] = docs;
                if (cmps)
                    this.completions[cmd] = cmps;
                if (this.dependencies[cmd] === undefined) {
                    const path = yield (0, exec_1.execFindDependency)(cmd);
                    if (path.trim() != '') {
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
        if (!node || node.childCount > 0 || node.text.trim() === '') {
            return null;
        }
        return node.text.trim();
    }
    getHover(params) {
        const uri = params.textDocument.uri;
        const tree = this.uriToSyntaxTree[uri];
        const node = this.nodeAtPoint(params.textDocument.uri, params.position.line, params.position.character);
        const text = this.wordAtPoint(params.textDocument.uri, params.position.line, params.position.character);
        if (!node || !text) {
            return;
        }
        if (this.globalDocs[text])
            return this.globalDocs[text];
        const cmdNode = (0, node_types_1.findParentCommand)(node);
        const localFunction = tree.functions.filter(n => (node == n) || (cmdNode == n))[0];
        const cmdText = (0, tree_sitter_1.getNodeText)(cmdNode);
        if (localFunction)
            return { contents: (0, documentation_1.enrichToCodeBlockMarkdown)(localFunction.text) };
        if (cmdNode && this.completions[cmdText])
            return (0, documentation_1.documentationHoverCommandArg)(cmdNode, this.completions[cmdText]);
        return;
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
function difference(oldArray, newArray) {
    return newArray.filter(node => !oldArray.includes(node));
}
class SyntaxTree {
    constructor(tree) {
        this.nodes = [];
        this.functions = [];
        this.commands = [];
        this.variable_defintions = [];
        this.variables = [];
        this.rootNode = tree.rootNode;
        this.tree = tree;
        this.clearAll();
        this.ensureAnalyzed();
    }
    ensureAnalyzed() {
        const newNodes = difference(this.nodes, (0, tree_sitter_1.getNodes)(this.rootNode));
        this.functions.push(...newNodes.filter(node => (0, node_types_1.isFunctionDefinintion)(node)));
        this.commands.push(...newNodes.filter(node => (0, node_types_1.isCommand)(node)));
        this.variables.push(...newNodes.filter(node => (0, node_types_1.isVariable)(node)));
        this.variable_defintions.push(...newNodes.filter(node => (0, node_types_1.isVariableDefintion)(node)));
        return newNodes;
    }
    clearAll() {
        this.nodes = [];
        this.functions = [];
        this.variables = [];
        this.variable_defintions = [];
        this.commands = [];
    }
    getUniqueCommands() {
        return [
            ...new Set(this.commands
                .map((node) => { var _a; return ((_a = node === null || node === void 0 ? void 0 : node.firstChild) === null || _a === void 0 ? void 0 : _a.text.trim()) || ""; })
                .filter(nodeStr => nodeStr != ""))
        ];
    }
    getNodeRanges() {
        return this.nodes.map(node => (0, tree_sitter_1.getRange)(node));
    }
    hasRoot() {
        return this.rootNode != null;
    }
    getNodes() {
        this.ensureAnalyzed();
        return this.nodes;
    }
}
exports.SyntaxTree = SyntaxTree;
//# sourceMappingURL=analyse.js.map