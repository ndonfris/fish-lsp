import { filterGlobalSymbols, filterLastPerScopeSymbol, filterLocalSymbols, findLastDefinition, findSymbolsForCompletion, FishDocumentSymbol, getFishDocumentSymbols, isGlobalSymbol, isUniversalSymbol, symbolIsImmutable } from './document-symbol';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { Position, Location, Range, SymbolKind, TextEdit, DocumentUri, WorkspaceEdit, RenameFile } from 'vscode-languageserver';
import { getChildNodes, getRange } from './utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { containsRange } from './workspace-symbol';
import { isCommandName } from './utils/node-types';


export function canRenamePosition(analyzer: Analyzer, document: LspDocument, position: Position): boolean {
    return !!analyzer.findDocumentSymbol(document, position);
}

export type RenameSymbolType = 'local' | 'global'

export function getRenameSymbolType(analyzer: Analyzer, document: LspDocument, position: Position): RenameSymbolType {
    const symbol = analyzer.findDocumentSymbol(document, position);
    if (!symbol) return 'local'

    if (isGlobalSymbol(symbol) || isUniversalSymbol(symbol)) {
        return 'global'
    }
    return 'local'
}

export type RenameChanges = {
    [uri: DocumentUri]: TextEdit[]
}

function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
    const equalRanges = (a: Range, b: Range) => {
        return (
            a.start.line === b.start.line &&
            a.start.character === b.start.character &&
            a.end.line === b.end.line &&
            a.end.character === b.end.character
        );
    }
    const matchingNames = nodes.filter(node => node.text === matchName)
    const uniqueRanges: Range[] = [] 
    matchingNames.forEach(node => {
        const range = getRange(node)
        if (uniqueRanges.some(u => equalRanges(u, range))) return
        uniqueRanges.push(range)
    })
    return uniqueRanges.map(range => Location.create(uri, range))
}


function findLocalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
    const symbol = analyzer.findDocumentSymbol(document, position);
    if (!symbol) return []
    const nodesToSearch = getChildNodes(symbol.scope.scopeNode)
    return findLocations(document.uri, nodesToSearch, symbol.name)
}

function removeLocalSymbols(matchSymbol: FishDocumentSymbol, nodes: SyntaxNode[], symbols: FishDocumentSymbol[]) {
    const name = matchSymbol.name
    const matchingSymbols = filterLocalSymbols(symbols.filter(symbol => symbol.name === name)).map(symbol => symbol.scope.scopeNode)
    const matchingNodes = nodes.filter(node => node.text === name)

    if (matchingSymbols.length === 0 || matchSymbol.kind === SymbolKind.Function) return matchingNodes

    return matchingNodes.filter((node) => {
        if (matchingSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) return false
        return true;
    })
}

function findGlobalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
    const locations: Location[] = []
    const symbol = analyzer.findDocumentSymbol(document, position);
    if (!symbol) return []
    const uris = analyzer.cache.uris()
    for (const uri of uris) {
        const doc = analyzer.getDocument(uri)!
        if (!doc.isAutoLoaded()) continue
        const rootNode = analyzer.getRootNode(doc)!
        const toSearchNodes = removeLocalSymbols(symbol, getChildNodes(rootNode), analyzer.cache.getFlatDocumentSymbols(uri))
        const newLocations = findLocations(uri, toSearchNodes, symbol.name)
        locations.push(...newLocations)
    }
    return locations
}

export function getRenameLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
    if (!canRenamePosition(analyzer, document, position)) return []
    let renameScope = getRenameSymbolType(analyzer, document, position)
    switch (renameScope) {
        case 'local':
            return findLocalLocations(analyzer, document, position)
        case 'global':
            return findGlobalLocations(analyzer, document, position)
        default:
            return []
    }
}

export function getRefrenceLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
    const node = analyzer.nodeAtPoint(document.uri, position.line, position.character)
    if (!node) return []
    const symbol = analyzer.getDefinition(document, position).pop()
    if (symbol) {
        const doc = analyzer.getDocument(symbol.uri)!
        const {scopeTag} = symbol.scope
        switch (scopeTag) {
            case 'global':
            case 'universal':
                return findGlobalLocations(analyzer, doc, symbol.selectionRange.start)
            case 'local':
            default:
                return findLocalLocations(analyzer, document, symbol.selectionRange.start)
        }
    }
    if (isCommandName(node)) {
        const uris = analyzer.cache.uris()
        const locations: Location[] = []
        for (const uri of uris) {
            const doc = analyzer.getDocument(uri)!
            const rootNode = analyzer.getRootNode(doc)!
            const nodes = getChildNodes(rootNode).filter(n => isCommandName(n))
            const newLocations = findLocations(uri, nodes, node.text)
            locations.push(...newLocations)
        }
        return locations
    }
    return []
}

const createRenameFile = (oldUri: DocumentUri, newUri: DocumentUri): RenameFile => {
    return {
        kind: 'rename',
        oldUri,
        newUri
    }
}

export function getRenameFiles(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): RenameFile[] | null {
    const renameFiles: RenameFile[] = []
    const symbol = analyzer.findDocumentSymbol(document, position);
    if (!symbol) return null
    if (symbol.kind !== SymbolKind.Function) return null
    if (symbolIsImmutable(symbol)) return null
    if (symbol.scope.scopeTag === 'global') {
        analyzer.getExistingAutoloadedFiles(symbol.name).forEach(uri => {
            const newUri = uri.replace(symbol.name, newName)
            renameFiles.push(createRenameFile(uri, newUri))
        })
    }
    return renameFiles
}
export function getRenameWorkspaceEdit(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): WorkspaceEdit | null {
    const locations = getRenameLocations(analyzer, document, position)
    if (!locations || locations.length === 0) return null

    const changes: RenameChanges = {}

    for (const location of locations) {
        const uri = location.uri
        const edits = changes[uri] || []
        edits.push(TextEdit.replace(location.range, newName))
        changes[uri] = edits
    }

    const documentChanges: RenameFile[] | null = getRenameFiles(analyzer, document, position, newName)
    if (documentChanges && documentChanges.length > 0) {
        return { changes, documentChanges }
    }

    return { changes }
}