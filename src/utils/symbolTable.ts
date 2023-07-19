import { SyntaxNode } from 'web-tree-sitter';
import { FishDocumentSymbol } from '../document-symbol';
import { isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariableDefinition} from './node-types';
import { getChildNodes, getRange } from './tree-sitter';
import { Range } from 'vscode-languageserver'

export class SymbolTable {

    private rootNode: SyntaxNode;
    private rootScope: Scope;
    public _scopes: Scope[];

    constructor(root: SyntaxNode) {
        this.rootNode = root;
        this.rootScope = new Scope(getRange(root), null, []);
        this._scopes = [this.rootScope]
    }

    build() {
        //const nodes = getChildNodes(this.rootNode)
        const children = this.scopeBuilder(this.rootScope, 0, ...this.rootNode.children)
        this.rootScope.addChildren(...children);
        //this.rootScope.define(...this.definitionBuilder(...this.rootNode.children));
    } 

    private scopeBuilder(parentScope: Scope | null, level: number = 0, ...currentNodes: SyntaxNode[]) {
        const scopes: Scope[] = [];
        //const definitions: FishDocumentSymbol[] = [];
        for (const node of currentNodes) {
            if (!isScope(node)) continue;
            const childScopes = this.scopeBuilder(parentScope, level+1, ...node.children);
            const scope = new Scope(getRange(node), parentScope, childScopes);
            scopes.push(scope)
        }
        return scopes
    }

    findScope(range: Range): Scope | null {
        const stack = [this.rootScope];
        let enclosing = this.rootScope;
        while (stack.length > 0) {
            const scope = stack.shift();
            if (scope) {
                stack.unshift(...scope.children);
                if (scope.insideRange(range)) enclosing = scope;
            }
        }
        return enclosing;
        
    }

    toString(): string {
        return this.rootScope.toString();
    }
}


class Scope {
    public parent: Scope | null;
    public children: Scope[] = [];
    public range: Range;
    public definitions: FishDocumentSymbol[] = [];

    constructor(range: Range, parent: Scope | null = null, children: Scope[] = []) {
        this.parent = parent;
        this.children = children;
        this.range = range;
    } 

    addChildren(...children: Scope[]) {
        this.children.push(...children);
    }

    addDefinition(...definitions: FishDocumentSymbol[]) {
        this.definitions.push(...definitions);
    }

    containsDefinition(symbolName: string): boolean {
        return this.definitions.some(definition => definition.name === symbolName);
    }

    enclosingScope(range: Range): Scope | null {
        if (!this.insideRange(range)) return this.parent
        if (this.isLeaf()) return this;
        const smallerScope = this.children.find(child => child.insideRange(range));
        return smallerScope ? smallerScope.enclosingScope(range) : this;
    }

    insideRange(check: Range): boolean {
        return this.range.start.character <= check.start.character && this.range.end.character >= check.end.character;
    }

    isRoot(): boolean {
        return this.parent === null;
    }

    isLeaf(): boolean {
        return this.children.length === 0;
    }

    hasParent(): boolean {
        return this.parent !== null;
    }

    withChildrenToString(indent: number = 0, showChildren: boolean = false): string {
        let childrenStr = '';
        if (showChildren && !this.isLeaf()) {
            childrenStr += '\n' + this.children.map(child => child.withChildrenToString(indent + 1, showChildren)).join('');
        }
        const indentStr = indent > 0 ? '     '.repeat(indent) : '';
        return [
            indentStr + 'SYMBOL',
            indentStr + 'hasParent: ' + this.hasParent().toString(),
            indentStr + `range: ${this.range.start.line}:${this.range.start.character} - ${this.range.end.line}:${this.range.end.character}`,
            indentStr + `definitions seen: ${this.definitions.map(definition => definition.name).join(' ')}`,
            childrenStr
        ].join('\n');
    }

    truncated() {
        return {
            isRoot: this.isRoot().toString(),
            isLeaf: this.isLeaf().toString(),
            hasParent: this.hasParent().toString(),
            range: this.range.start.line + ':' + this.range.start.character + ' - ' + this.range.end.line + ':' + this.range.end.character,
            definitions: this.definitions.map(definition => definition.name).join(' '),
            children: this.children.length,
        };
    }

    toString(): string {
        return this.toString()
    }
}


