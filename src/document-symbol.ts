
import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition, isVariableDefinitionName, refinedFindParentVariableDefinitionKeyword } from './utils/node-types'
import { findVariableDefinitionOptions } from './utils/options';
import { DocumentSymbolDetail } from './utils/symbol-documentation-builder';
import { pathToRelativeFunctionName } from './utils/translation';
import { getNodeAtRange, getRange, positionToPoint } from './utils/tree-sitter';
import { DefinitionScope, getScope } from './utils/definition-scope'


// add some form of tags to the symbol so that we can extend the symbol with more information
// current implementation is WIP inside file : ./utils/options.ts
export interface FishDocumentSymbol extends DocumentSymbol {
    name: string;
    uri: string;
    detail: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    scope: DefinitionScope;
    children: FishDocumentSymbol[];
}

export namespace FishDocumentSymbol {
    /**
     * Creates a new symbol information literal.
     *
     * @param name The name of the symbol.
     * @param detail The detail of the symbol.
     * @param kind The kind of the symbol.
     * @param uri The documentUri of the symbol.
     * @param range The range of the symbol.
     * @param selectionRange The selectionRange of the symbol.
     * @param children Children of the symbol.
     */
    export function create(name: string,  uri: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range, scope: DefinitionScope, children: FishDocumentSymbol[]): FishDocumentSymbol {
        return {
            name,
            uri,
            detail,
            kind,
            range,
            selectionRange,
            scope,
            children,
        } as FishDocumentSymbol;
    }

    export function copy(symbol: FishDocumentSymbol, newChildren: FishDocumentSymbol[] = []): FishDocumentSymbol {
        return create(
            symbol.name,
            symbol.uri,
            symbol.detail,
            symbol.kind,
            symbol.range,
            symbol.selectionRange,
            symbol.scope,
            newChildren,
        )
    }

    export function equal(a: FishDocumentSymbol, b: FishDocumentSymbol): boolean {
        return a.name === b.name &&
            a.uri === b.uri &&
            a.range.start === b.range.start &&
            a.range.end === b.range.end &&
            a.selectionRange.start === b.selectionRange.start &&
            a.selectionRange.end === b.selectionRange.end;
    }

    export function toWorkspaceSymbol(symbol: FishDocumentSymbol): WorkspaceSymbol {
        return WorkspaceSymbol.create(
            symbol.name,
            symbol.kind,
            symbol.uri,
            symbol.range,
        )
    }

    export function logString(symbol: FishDocumentSymbol): string {
        const symbolIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        return `${symbolIcon}${symbol.name}   ::::  ${symbol.scope.scopeTag}`;   
    }

    export function* flattenArray(symbols: FishDocumentSymbol[]) : Generator<FishDocumentSymbol> {
        for (const symbol of symbols) {
            yield symbol;
            yield* flattenArray(symbol.children);
        }
    }

    export function equalScopes(a: FishDocumentSymbol, b: FishDocumentSymbol): boolean {
        if (a.scope.scopeNode && b.scope.scopeNode) {
            return a.scope.scopeTag === b.scope.scopeTag &&
                a.scope.scopeNode.equals(b.scope.scopeNode)
        }
        return false;
    }

    /*
     * the first symbol is before the second symbol
     */
    export function isBefore(first: FishDocumentSymbol, second: FishDocumentSymbol): boolean {
        return first.range.start.line < second.range.start.line;
    }

    /*
     * the first symbol is after the second symbol
     */
    export function isAfter(first: FishDocumentSymbol, second: FishDocumentSymbol): boolean {
        return first.range.start.line > second.range.start.line;
    }

    export function getSyntaxNode(root: SyntaxNode, symbol: FishDocumentSymbol): SyntaxNode | null {
        return getNodeAtRange(root, symbol.range);
    }
}

/**
 * Checks if a FishDocumentSymbol's state, should NOT be changeable.
 * Renaming a FishDocumentSymbol across the entire workspace, shouldn't
 * be possible for internal symbols (seen in '/usr/share/fish/**.fish').
 */
export function symbolIsImmutable(symbol: FishDocumentSymbol): boolean {
    const {uri, scope} = symbol;
    return uri.startsWith('/usr/share/fish/') || scope.scopeTag === 'universal';
}

export function isGlobalSymbol(symbol: FishDocumentSymbol): boolean {
    return symbol.scope.scopeTag === 'global';
}

export function isUniversalSymbol(symbol: FishDocumentSymbol): boolean {
    return symbol.scope.scopeTag === 'universal';
}

export function filterGlobalSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    return flattenFishDocumentSymbols(symbols)
        .filter((symbol) => symbol.scope.scopeTag === 'global')
}


export function flattenFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const queue = [...symbols];
    const result: FishDocumentSymbol[] = [];
    while (queue.length > 0) {
        const symbol = queue.shift();
        if (symbol) result.push(symbol);
        if (symbol && symbol.children) queue.unshift(...symbol.children);
    }
    return result;
}

export function filterLastFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const result: FishDocumentSymbol[] = []
    for (const symbol of symbols) {
        if (result.filter(res => res.name === symbol.name).length > 0) {
            result.splice(result.findIndex(res => res.name === symbol.name), 1)
        }
        const uniqs: FishDocumentSymbol[] = [];
        const dupes = filterLastFishDocumentSymbols(symbol.children)
        while (dupes.length > 0) {
            const child = dupes.pop();
            if (child && uniqs.filter(uniq => uniq.name === child.name).length === 0) {
                uniqs.unshift(child);
                continue;
            }
        }
        result.push(FishDocumentSymbol.copy(symbol, uniqs));
    }
    return result;
}

/**
 * TreeSitter definition nodes in fish shell rely on commands, and thus create trees that
 * need specific traversals per command. Creates a standard object of properties to be
 * deconstructed into a FishDocumentSymbol. Where parent is the root most node of the 
 * entire command to create a symbol. Child is the identifier of the symbol. 
 *
 * See fish below:
 * ---------------------------------------------------------------------------------------
 * set -gx FOO BAR; # FOO is a variable we globally define and export
 * ---------------------------------------------------------------------------------------
 * Child is just the identifier `$FOO`
 * Parent is the entire string `set -gx FOO BAR;` for the command
 */
export function definitionSymbolHandler(node: SyntaxNode): {
    shouldCreate: boolean;
    kind: SymbolKind;
    child: SyntaxNode;
    parent: SyntaxNode;
}{
    let shouldCreate = false;
    let [child, parent] = [ node, node.parent || node ];
    let kind: SymbolKind = SymbolKind.Null;
    if (isVariableDefinitionName(node)) {
        parent = refinedFindParentVariableDefinitionKeyword(node)!.parent!;
        kind = SymbolKind.Variable;
        shouldCreate = true;
    } else if (node.firstNamedChild && isFunctionDefinitionName(node.firstNamedChild)) {
        child = node.firstNamedChild!;
        kind = SymbolKind.Function;
        shouldCreate = true;
    }
    return {
        shouldCreate,
        kind,
        child,
        parent,
    }
}

/**
 * Creates all FishDocumentSymbols in a file
 * @param {string} uri - path to the file 
 * @param {SyntaxNode[]} currentNodes - root node(s) to traverse for definitions 
 * @returns {FishDocumentSymbol[]} - all defined FishDocumentSymbol's in file
 */
export function getFishDocumentSymbols(uri: string, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    for (const node of currentNodes) {
        const childrenSymbols = getFishDocumentSymbols(uri, ...node.children);
        const { shouldCreate, kind, child, parent } = definitionSymbolHandler(node);
        if (shouldCreate) {
            symbols.push(
                FishDocumentSymbol.create(
                    child.text,
                    uri,
                    DocumentSymbolDetail.create(child.text, uri, kind, child),
                    kind,
                    getRange(parent),
                    getRange(child),
                    getScope(uri, child),
                    childrenSymbols
                )
            );
            continue;
        }
        symbols.push(...childrenSymbols);
    }
    return symbols;
}