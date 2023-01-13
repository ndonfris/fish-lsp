import {DocumentUri, Location} from 'vscode-languageserver-protocol/node';
import {Point, SyntaxNode, Tree, TreeCursor} from 'web-tree-sitter'
import {isVariableDefintion} from './node-types';
import {getRange} from './tree-sitter';

// implement all useful methods for a syntax node
// getType()


// https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/binding.js
// issue is that it would not be useable by parser
// and would require reparsing
export class FishSyntaxNode implements SyntaxNode {

    node: SyntaxNode;
    id: number;
    tree: Tree;
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    parent: SyntaxNode | null;
    children: SyntaxNode[];
    namedChildren: SyntaxNode[];
    childCount: number;
    namedChildCount: number;
    firstChild: SyntaxNode | null;
    firstNamedChild: SyntaxNode | null;
    lastChild: SyntaxNode | null;
    lastNamedChild: SyntaxNode | null;
    nextSibling: SyntaxNode | null;
    nextNamedSibling: SyntaxNode | null;
    previousSibling: SyntaxNode | null;
    previousNamedSibling: SyntaxNode | null;

    uri: DocumentUri;

    constructor(node: SyntaxNode, uri: DocumentUri) {
        this.node = node;
        this.uri = uri;
        this.id = node.id
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

    hasChanges(): boolean {
        return this.node.hasChanges();
    }
    hasError(): boolean {
        return this.node.hasError();
    }
    equals(other: SyntaxNode): boolean {
        return this.node.equals(other);
    }
    isMissing(): boolean {
        return this.node.isMissing();
    }
    isNamed(): boolean {
        return this.node.isNamed();
    }
    toString(): string {
        return this.node.toString();
    }
    child(index: number): SyntaxNode | null {
        return this.node.child(index)
    }
    namedChild(index: number): SyntaxNode | null {
        return this.node.namedChild(index)
    }
    childForFieldId(fieldId: number): SyntaxNode | null {
        return this.node.childForFieldId(fieldId)
    }

    childForFieldName(fieldName: string): SyntaxNode | null {
        return this.node.childForFieldName(fieldName)
    }
    descendantForIndex(index: number): SyntaxNode; 
    descendantForIndex(startIndex: number, endIndex?: number): SyntaxNode {
        if (endIndex) {
            return this.node.descendantForIndex(startIndex, endIndex)
        }
        return this.node.descendantForIndex(startIndex)
    }

    descendantsOfType(type: string | string[], startPosition?: Point | undefined, endPosition?: Point | undefined): SyntaxNode[] {
        //return this.node.descendantsOfType(type, startPosition, endPosition)
        return this.node.descendantsOfType(type, startPosition, endPosition)
    }
    namedDescendantForIndex(index: number): SyntaxNode;
    namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    namedDescendantForIndex(startIndex: unknown, endIndex?: unknown): SyntaxNode {
        return this.node.namedDescendantForIndex(startIndex as number, endIndex as number)
    }

    descendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode {
        if (endPosition) {
            return this.node.descendantForPosition(startPosition, endPosition)
        }
        return this.node.descendantForPosition(startPosition)
    }
    namedDescendantForPosition(position: Point): SyntaxNode 
    namedDescendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode {
        if (endPosition) {
            return this.node.namedDescendantForPosition(startPosition, endPosition)
        }
        return this.node.namedDescendantForPosition(startPosition)
    }

    walk(): TreeCursor {
        return this.node.walk()
    }

    // here is where implementation varies from web-tree-sitter
    getLocation(): Location {
        return {
            uri: this.uri,
            range: getRange(this.node)
        }
    }

    // implement
    getFishType() {
        let fishType = this.node.type;
        if (isVariableDefintion(this.node)) {
            this.node.type = 'variable_definition'
            fishType = this.node.type
        } 
        return fishType
    }
}


// test which way is better
interface FishNode extends SyntaxNode {
    uri: DocumentUri
    node: SyntaxNode
    location: Location
}
