//import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {Analyzer} from './analyze';
import {CommentRange, toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, findParentCommand, findParentFunction, isCommandName, isDefinition, isForLoop, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFunctionName} from './utils/translation';
import {findEnclosingScope, findFirstParent, getChildNodes, getNodeAtRange, getParentNodes, getRange, positionToPoint} from './utils/tree-sitter';

export function createSymbol(node: SyntaxNode, children: DocumentSymbol[] = []) : DocumentSymbol | null {
    if (isDefinition(node)) {
        const formattedRange = CommentRange.create(node)
        return {
            ...formattedRange.toDocumentSymbol(),
            children,
        }
    } else {
        return null;
    }
}

export namespace DefinitionSymbol {
    export const createFunction = (node: SyntaxNode) => {
        const identifier = node.firstNamedChild || node.firstChild!;
        const commentRange = CommentRange.create(identifier);
        // @TODO: implement const {  enclosingText, enclosingNode, encolsingType } 
        //        = DefinitionSyntaxNode.getEnclosingScope(parentNode);
        return DocumentSymbol.create(
            identifier.text,
            commentRange.markdown(), // add detail here
            SymbolKind.Function,
            getRange(node), //commentRange.(), // as per the docs, range should include comments
            getRange(identifier),
            []
        );
    }

    export const createVariable = (node: SyntaxNode) => {
        const parentNode = node.parent!; 
        const commentRange = CommentRange.create(node)
        const withCommentText = isFunctionDefinition(parentNode) ? parentNode.text.toString() : commentRange.text()
        // @TODO: implement const {  enclosingText, enclosingNode, encolsingType }
        //        = DefinitionSyntaxNode.getEnclosingScope(parentNode);
        return DocumentSymbol.create(
            node.text,
            [ 
                `\*(variable)* \**${node.text}**`,
                //enclosingText,
                "___",
                "```fish",
                `${withCommentText.trim()}`,
                "```",
            ].join("\n"),
            SymbolKind.Variable,
            getRange(parentNode), // as per the docs, range should include comments
            getRange(node),
            []
        );
    }
}


/**
 * This is the recursive solution to building the document symbols (for definitions).
 *
 * @see createFunctionDocumentSymbol
 * @see createVariableDocumentSymbol
 *
 * @param {SyntaxNode} node - the node to start the recursive search from
 * @returns {DocumentSymbol[]} - the resulting DocumentSymbols, which is a TREE not a flat list
 */
export function collapseToSymbolsRecursive(node: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    if (isFunctionDefinition(node)) {
        const symbol = DefinitionSymbol.createFunction(node);
        node.children.forEach((child) => {
            const childSymbols = collapseToSymbolsRecursive(child);
            if (!symbol.children) symbol.children = [];
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(node)) {
        const symbol = DefinitionSymbol.createVariable(node);
        symbols.push(symbol);
    } else {
        node.children.forEach((child) => {
            symbols.push(...collapseToSymbolsRecursive(child));
        })
    }
    return symbols;
}

/**
 * gets all the symbols of a depth before the variableNode.
 *
 * `function func_a 
 *     set -l var_b; set -l var_c
 *  end
 *  set -l search_for
 *  echo $search_for `<-- starting here 
 *  would show a pruned tree of:
 *       - `func_a`
 *       - `search_for`
 *  `var_b`, and `var_c` are not reachable and have been pruned
 */
function pruneClientTree(rootNode: SyntaxNode, variableNode: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(rootNode);

    const prunedSymbols: DocumentSymbol[] = []
    let nextSymbols : DocumentSymbol[] = [...symbols]
    let currentNode: SyntaxNode | null = variableNode.parent;

    while (currentNode && currentNode?.type !== 'program') {
        currentNode = currentNode.parent;
        const currentLevel = [...nextSymbols.filter(n => n !== undefined)];
        prunedSymbols.push(...currentLevel);
        nextSymbols = [];
        currentLevel.forEach(symbol => {
            if (symbol.children) nextSymbols.push(...symbol.children)
        })
    }
    return prunedSymbols;
}

export function findMostRecentDefinition(rootNode: SyntaxNode, searchNode: SyntaxNode): DocumentSymbol | undefined {
    const prunedSymbols = pruneClientTree(rootNode, searchNode);
    const recentDefinition = prunedSymbols.filter(symbol => symbol.name === searchNode.text);
    for (const recentlyDefined of recentDefinition.reverse()) {
        if (recentlyDefined.selectionRange.start.line < getRange(searchNode).start.line
        ) {
            return recentlyDefined
        } else if ( recentlyDefined.selectionRange.start.line === getRange(searchNode).start.line
            //&& recentlyDefined.selectionRange.start.character <= getRange(searchNode).start.character
            //&& recentlyDefined.selectionRange.end.character <= getRange(searchNode).end.character
        ) {
            return recentlyDefined
        }
    }
    return undefined
}


/**
 * Shows the workspace heirarcharal symbols, in a tree format in the client. Unlike
 * collapseToSymbolsRecursive(), this function removes duplicate identifiers in the same
 * scope, and only ends up storing the last refrence.
 *
 * @param {SyntaxNode} root - The root node of the syntax tree.
 *
 * @returns {DocumentSymbol[]} - The document symbols, without duplicates in the same scope.
 */
export function toClientTree(root: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(root);
    const seenSymbols: Set<string> = new Set();
    const result: DocumentSymbol[] = [];

    for (const symbol of symbols) {
        const node = getNodeAtRange(root, symbol.range);
        let parent = node?.parent || node;
        while (parent) {
            if (isScope(parent)) {
                if (!seenSymbols.has(symbol.name)) {
                    seenSymbols.add(symbol.name);
                    result.push(symbol);
                }
                break;
            }
            parent = parent.parent;
        }
    }
    return result;
}

export function getDefinitionSymbols(root: SyntaxNode) {
    let parentSymbol: DocumentSymbol | null = null;
    let currentSymbol: DocumentSymbol | null = null;
    let symbols: DocumentSymbol[] = [];
    let queue: SyntaxNode[] = [root];

    while (queue.length > 0) {
        const node = queue.shift()!;
        if (isVariableDefinition(node)) {
            currentSymbol = createSymbol(node);
            if (!currentSymbol) continue; // should never happen
            if (!parentSymbol) symbols.push(currentSymbol);
            if (parentSymbol && containsRange(parentSymbol.range, currentSymbol.range)) {
                if (!parentSymbol.children) {
                    parentSymbol.children = [];
                }
                parentSymbol.children.push(currentSymbol);
            }
        } else if (isFunctionDefinitionName(node)) {
            currentSymbol = createSymbol(node);
            parentSymbol = currentSymbol;
        } else if (parentSymbol && !containsRange(parentSymbol.range, getRange(node))) {
            symbols.push(parentSymbol)
            parentSymbol = null;
        }
        queue.unshift(...node?.children)
    }
    return symbols;
}



export function countParentScopes(first: SyntaxNode){
    let node1 : SyntaxNode | null = first;
    let count = 0;
    while (node1) {
        if (isScope(node1)) {
            count++;
        }
        node1 = node1.parent
    }
    return count - 1;
}

export function getNodeFromRange(root: SyntaxNode, range: Range) {
    return root.descendantForPosition(
        positionToPoint(range.start),
        positionToPoint(range.end)
    ); 
}
export function getNodeFromSymbol(root: SyntaxNode, symbol: DocumentSymbol) {
    return getNodeFromRange(root, symbol.selectionRange)
}

function getMostRecentSymbols(symbols: DocumentSymbol[], range: Range) {
    const symbolMap: Map<string, DocumentSymbol> = new Map();
    for (const sym of symbols) {
        if (range.start.line <= sym.range.start.line) continue; // skip symbols on same line
        if (symbolMap.has(sym.name)) {                          // place duplicate symbols
            symbolMap.set(sym.name, sym);
            continue;
        } 
        symbolMap.set(sym.name, sym)                             // place initial symbols
    }
    return Array.from(symbolMap.values())
}

export function getNearbySymbols(root: SyntaxNode, range: Range) {
    const symbols: DocumentSymbol[] = getDefinitionSymbols(root);
    const flatSymbols : DocumentSymbol[] = flattenSymbols(symbols);
    const funcs = symbols.filter((sym) => sym.kind === SymbolKind.Function);
    const scopeSymbol = funcs.find((funcSym) => containsRange(funcSym.range, range))
    if (!scopeSymbol) {                                          // symbols outside of any local scope
        return [...getMostRecentSymbols(symbols, range), ...funcs].filter(
        (item: DocumentSymbol, index: number, self: DocumentSymbol[]) =>
            self.findIndex((otherItem) => item.name === otherItem.name) === index ) // remove duplicate function symbols
    }
    return [...getMostRecentSymbols(flatSymbols, range), ...funcs].filter(
        (item: DocumentSymbol, index: number, self: DocumentSymbol[]) =>
            self.findIndex((otherItem) => item.name === otherItem.name) === index 
    ) // remove duplicate function symbols
}

function flattenSymbols(symbols: DocumentSymbol[]) {
    const queue = [...symbols];
    const result: DocumentSymbol[] = [];
    while (queue.length > 0) {
        const symbol = queue.shift();
        if (symbol) result.push(symbol);
        if (symbol && symbol.children) queue.unshift(...symbol.children);
    }
    return result;
}

export function containsRange(range: Range, otherRange: Range): boolean {
  if (otherRange.start.line < range.start.line || otherRange.end.line < range.start.line) {
    return false
  }
  if (otherRange.start.line > range.end.line || otherRange.end.line > range.end.line) {
    return false
  }
  if (otherRange.start.line === range.start.line && otherRange.start.character < range.start.character) {
    return false
  }
  if (otherRange.end.line === range.end.line && otherRange.end.character > range.end.character) {
    return false
  }
  return true
}

export function precedesRange(before: Range, after: Range): boolean {
  if (before.start.line < after.start.line) {
    return true
  } 
  if (before.start.line === after.start.line && before.start.character < after.start.character) {
    return true
  }
  return false
}

/* Either we need to open a new doc or we have a definition in our current document
 * Or there is no definition (i.e. a builtin)
 */
export enum DefinitionKind {
    LOCAL,
    FILE,
    NONE
}

export function getDefinitionKind(uri: string, root: SyntaxNode, current: SyntaxNode, localDefintions: Location[]): DefinitionKind {
    if (isBuiltin(current.text)) return DefinitionKind.NONE;
    localDefintions.push(...getLocalDefs(uri, root, current))
    if (localDefintions.length > 0) {
        return DefinitionKind.LOCAL;
    }
    if (isCommandName(current)) return DefinitionKind.FILE;
    return DefinitionKind.NONE;
}

export function getLocalDefs(uri: string, root: SyntaxNode, current: SyntaxNode) {
    const definition = current.text === "argv" 
        ? findEnclosingScope(current)
        : getReferences(uri, root, current)
            .map(refLocation => getNodeAtRange(root, refLocation.range))
            .filter(n => n)
            .find(n => n && isDefinition(n)) 
    if (!definition) return []
    return [Location.create(uri, getRange(definition))]
}

export function getReferences(uri: string, root: SyntaxNode, current: SyntaxNode) : Location[]{
    return getChildNodes(root)
        .filter((n) => n.text === current.text)
        .filter((n) => isVariable(n) || isFunctionDefinitionName(n) || isCommandName(n))
        .filter((n) => containsRange(getRange(findEnclosingScope(n)), getRange(current)))
        .map((n) => Location.create(uri, getRange(n))) || []
}

export function getMostRecentReference(uri: string, root: SyntaxNode, current: SyntaxNode) {
    const definitions : SyntaxNode[] = current.text === "argv"
        ? [findEnclosingScope(current)]
        : getChildNodes(root)
        .filter((n) => n.text === current.text)
        .filter((n) => isDefinition(n))

    let mostRecent = definitions.find(n => n && isDefinition(n))
    definitions.forEach(defNode => {
        if (isVariable(current) && precedesRange(getRange(defNode), getRange(current))) {
            mostRecent = defNode
        }
    })
    return mostRecent
}
export namespace DefinitionSyntaxNode {
    export const ScopeTypesSet = new Set(["global", "function", "local", "block"]);
    export type ScopeTypes = "global" | "function" | "local" | "block";
    export type VariableCommandNames = "set" | "read" | "for" | "function" // FlagsMap.keys()
    const _Map = {
        read: {
            global:   ["-g", '--global'],
            local:    ["-l", "--local"],
            function: ["-f", "--function"],
        },
        set: {
            global:   ["-g", '--global'],
            local:    ["-l", "--local"],
            function: ["-f", "--function"],
        },
        for: {block: [] },
        function: { 
            function: ["-A", "--argument-names", "-v", "--on-variable"],
            global:   ["-V", "--inherit-variable", '-S', '--no-scope-shadowing'],
        },
    }
    /**
     * Map containing the flags, for a command
     * {
     *     "read": => Map(3) {
     *           "global" => Set(2) { "-g", "--global" },
     *           "local" => Set(2) { "-l", "--local" },
     *           "function" => Set(2) { "-f", "--function" }
     *     }
     *     ...
     * }
     * Usage:
     * FlagsMap.keys()                    => Set(4) { "read", "set", "for", "function }
     * FlagsMap.get("read").get("global") => Set(2) { "-g", "--global" }
     * FlagsMap.get("read").get("global").has("-g") => true
     */
    export const FlagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => {
        return [command, new Map(Object.entries(scopes).map(([scope, flags]) => {
            return [scope, new Set(flags)];
        }))];
    }));
    /**
     * Simple helper to check if the parent node is found in our look up FlagMap.keys()
     *
     * @param {SyntaxNode} node - variable or function node 
     * @returns {boolean} true if the parent node is a a key in the FlagMap
     */
    export function hasCommand(node: SyntaxNode){
        const parent = findParentCommand(node) || node?.parent;
        const commandName = parent?.text.split(' ')[0] || ''
        console.log({commandName, var: node.text})
        return parent && [...FlagsMap.keys()].includes(commandName)
    }

    export function hasScope(node: SyntaxNode) {
        if (isFunctionDefinition(node)) return true
        return hasCommand(node) && isVariableDefinition(node)
    }

    export function getScope(node: SyntaxNode) {
        if (isFunctionDefinition(node)) return "function"
        const commandNode = findParentCommand(node) || node.parent
        const commandName = commandNode?.text.split(' ')[0] || ''
        const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
        if (!flags || commandName === 'for') return 'local'

        const commandScopes = FlagsMap.get(commandName);
        if (!commandScopes) return 'local';

        for (const [scope, flagSet] of commandScopes.entries()) {
            if (flags.some(flag => flagSet.has(flag))) return scope;
        }
        return 'local'
    }

    export interface EnclosingDefinitionScope {
        encolsingType: "function" | "block" | "local" | "global";
        enclosingText: string;
        enclosingNode: SyntaxNode;
    }
    export function createEnclosingScope(type: ScopeTypes, node: SyntaxNode): EnclosingDefinitionScope {
        let enclosingText = `in \**${type}** scope`
        if (type === 'function') enclosingText = `in \**${type.toString()}** scope`  
        else if (type === 'block' && isForLoop(node)) enclosingText = `in \**${type.toString()}** \*for_loop* scope`  
        //let enclosingText = `in \**${type.toString()}** scope`
        //if (type === 'global') {enclosingText = `in \**${type}** scope`}
        //else if (type === 'local') {enclosingText = `in \**${type}** scope`}
        //else if (type === 'function') {enclosingText = `in \**${type}** scope: \*${node.firstChild}*`}
        return {encolsingType: type, enclosingText, enclosingNode: node}
    } 

    // @TODO: implement find enclosing scope for a node
    export function getEnclosingScope(node: SyntaxNode) : EnclosingDefinitionScope {
        if (isFunctionDefinition(node)) return createEnclosingScope("function", node)
        const commandNode = node?.parent?.type === 'for_loop' ? node.parent : findParentCommand(node)
        const commandName = commandNode?.text.split(' ')[0] || ''
        const flags = commandNode?.children.map(c => c.text).filter(flag => flag.startsWith('--')) || []
        if (!commandNode) return createEnclosingScope('local', node)
        if (commandName === 'for') return createEnclosingScope("block", commandNode)

        const commandScopes = FlagsMap.get(commandName);
        if (!flags.length || !commandScopes) return createEnclosingScope('local', commandNode)

        for (const [scope, flagSet] of commandScopes.entries()) {
            if (flags.some(flag => flagSet.has(flag))) return createEnclosingScope(scope.toString() as ScopeTypes, commandNode);
        }
        return createEnclosingScope('local', commandNode)
    }

}


