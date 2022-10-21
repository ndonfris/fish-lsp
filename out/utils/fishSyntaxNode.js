"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FishSyntaxNode = void 0;
const node_types_1 = require("./node-types");
const tree_sitter_1 = require("./tree-sitter");
// implement all useful methods for a syntax node
// getType()
// https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/binding.js
// issue is that it would not be useable by parser
// and would require reparsing
class FishSyntaxNode {
    constructor(node, uri) {
        this.node = node;
        this.uri = uri;
        this.id = node.id;
        this.tree = node.tree;
        this.type = node.type;
        this.text = node.text;
        this.startPosition = node.startPosition;
        this.endPosition = node.endPosition;
        this.startIndex = node.startIndex;
        this.endIndex = node.endIndex;
        this.parent = node.parent;
        this.children = node.children;
        this.namedChildren = node.namedChildren;
        this.childCount = node.childCount;
        this.namedChildCount = node.namedChildCount;
        this.firstChild = node.firstChild;
        this.firstNamedChild = node.firstNamedChild;
        this.lastChild = node.lastChild;
        this.lastNamedChild = node.lastNamedChild;
        this.nextSibling = node.nextSibling;
        this.nextNamedSibling = node.nextNamedSibling;
        this.previousSibling = node.previousSibling;
        this.previousNamedSibling = node.previousNamedSibling;
    }
    hasChanges() {
        return this.node.hasChanges();
    }
    hasError() {
        return this.node.hasError();
    }
    equals(other) {
        return this.node.equals(other);
    }
    isMissing() {
        return this.node.isMissing();
    }
    isNamed() {
        return this.node.isNamed();
    }
    toString() {
        return this.node.toString();
    }
    child(index) {
        return this.node.child(index);
    }
    namedChild(index) {
        return this.node.namedChild(index);
    }
    childForFieldId(fieldId) {
        return this.node.childForFieldId(fieldId);
    }
    childForFieldName(fieldName) {
        return this.node.childForFieldName(fieldName);
    }
    descendantForIndex(startIndex, endIndex) {
        if (endIndex) {
            return this.node.descendantForIndex(startIndex, endIndex);
        }
        return this.node.descendantForIndex(startIndex);
    }
    descendantsOfType(type, startPosition, endPosition) {
        //return this.node.descendantsOfType(type, startPosition, endPosition)
        return this.node.descendantsOfType(type, startPosition, endPosition);
    }
    namedDescendantForIndex(startIndex, endIndex) {
        return this.node.namedDescendantForIndex(startIndex, endIndex);
    }
    descendantForPosition(startPosition, endPosition) {
        if (endPosition) {
            return this.node.descendantForPosition(startPosition, endPosition);
        }
        return this.node.descendantForPosition(startPosition);
    }
    namedDescendantForPosition(startPosition, endPosition) {
        if (endPosition) {
            return this.node.namedDescendantForPosition(startPosition, endPosition);
        }
        return this.node.namedDescendantForPosition(startPosition);
    }
    walk() {
        return this.node.walk();
    }
    // here is where implementation varies from web-tree-sitter
    getLocation() {
        return {
            uri: this.uri,
            range: (0, tree_sitter_1.getRange)(this.node)
        };
    }
    // implement
    getFishType() {
        let fishType = this.node.type;
        if ((0, node_types_1.isVariableDefintion)(this.node)) {
            this.node.type = 'variable_definition';
            fishType = this.node.type;
        }
        return fishType;
    }
}
exports.FishSyntaxNode = FishSyntaxNode;
//# sourceMappingURL=fishSyntaxNode.js.map