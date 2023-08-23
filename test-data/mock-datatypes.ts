import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { FishCompletionItem, FishCompletionItemKind, toCompletionKindString } from '../src/utils/completion-strategy';
import { FishDocumentSymbol } from '../src/document-symbol';
import { pathToUri, symbolKindToString, toLspDocument, uriToPath } from '../src/utils/translation';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { getRange } from '../src/utils/tree-sitter';

// 
// CompletionItem -> mocking for CompletionItem
//
export interface CompletionItem {
    label: string,
    kind: string,
    fishKind: string,
}

export namespace CompletionItem {
    export function create(label: string, fishKind: FishCompletionItemKind ) : CompletionItem {
        return {
            label: label,
            kind: toCompletionKindString[fishKind], 
            fishKind: FishCompletionItemKind[fishKind],
        }
    }
    export function fromCompletion(cmp: FishCompletionItem) : CompletionItem {
        return {
            label: cmp.label,
            kind: toCompletionKindString[cmp.fishKind],
            fishKind: FishCompletionItemKind[cmp.fishKind],
        }
    }
    export function readable(item: FishCompletionItem){
        return {
            ...item,
            kind: toCompletionKindString[item.fishKind],
            fishKind: FishCompletionItemKind[item.fishKind],
        };
    }
    export function log(items: FishCompletionItem[], max: number = 5) {
        items.forEach((item: FishCompletionItem, i: number) => {
            if (i < max) console.log(i, '::', readable(item), '\n');
        })
        console.log(`...`)
        console.log(`total items: ${items.length}`);
    }
}


export type PositionArray = [number, number];
// 
// Position -> mocking for Position (LSP)
//
export interface Position {
    line: number,
    character: number,
}
export namespace Position {
    export function create(line: number, character: number) : Position {
        return {
            line: line,
            character: character,
        }
    }
    export function fromPosition(position: LSP.Position) : Position {
        return create(position.line, position.character);
    }
    export function fromArray([line, character]: [number, number]) : Position {
        return create(line, character);
    }
    export function toString(position: Position) : string {
        return `${position.line}:${position.character}`
    }
    export function equals(a: Position, b: Position) : boolean {
        return a.line === b.line && a.character === b.character;
    }
}

// 
// Range -> mocking for Range (LSP)
//
export interface Range {
    start: Position,
    end: Position,
}
export namespace Range {
    export function create(start: Position, end: Position) : Range {
        return {
            start: start,
            end: end,
        }
    }
    export function fromRange(range: LSP.Range) : Range {
        return create(
            Position.create(range.start.line, range.start.character),
            Position.create(range.end.line, range.end.character)
        );
    }
    export function fromArray([start, end]: [PositionArray, PositionArray]) : Range {
        let startPos = Position.fromArray(start);
        let endPos = Position.fromArray(end);
        return create(startPos, endPos);
    }
    export function toPositionArray(range: Range) : PositionArray[] {
        return [ [range.start.line, range.start.character], [range.end.line, range.end.character] ]
    }
    export function toString(range: Range) : string {
        return `${Position.toString(range.start)} - ${Position.toString(range.end)}`
    }
}

//
// Symbol -> mocking for Symbol (DocumentSymbol)
//
export interface Symbol {
    name: string,
    kind: string,
    range: Range,
    selectionRange: Range,
    children: Symbol[],
}
export namespace Symbol {
    export function create(name: string, kind: string, range: Range, selectionRange: Range, children: Symbol[]) : Symbol {
        return {
            name: name,
            kind: kind,
            range: range,
            selectionRange: selectionRange,
            children: children,
        }
    }
    export function fromFishDocumentSymbol(symbol: FishDocumentSymbol) : Symbol {
        return create(
            symbol.name,
            symbolKindToString(symbol.kind),
            Range.fromRange(symbol.range),
            Range.fromRange(symbol.selectionRange),
            symbol.children.map(fromFishDocumentSymbol),
        )
    }
}

//
// Document -> mocking for LspDocument
//
export namespace Document {
    export function create(uri: string, content: string) : LspDocument {
        return toLspDocument(uri, content);
    }

    export function createFunction(functionName: string, content: string) : LspDocument {
        const uri = `${homedir()}/.config/fish/functions/${functionName}.fish`;
        return create(uri, content);
    }

    export function equals(a: LspDocument, b: LspDocument) : boolean {
        return (
            a.uri === b.uri &&
            a.getText() === b.getText() &&
            a.version === b.version &&
            a.languageId === b.languageId
        );
    }
}


//
// FoldingRange -> mocking for FoldingRange (LSP)
//
export interface FoldingRange {
    start: Position,
    end: Position,
    kind: string,
    collapsedText: string,
}
export namespace FoldingRange {
    export function create(start: Position, end: Position, kind: string, collapsedText: string) : FoldingRange {
        return {
            start,
            end,
            kind,
            collapsedText,
        }
    }
    export function fromArray(start: PositionArray, end: PositionArray, kind: string, collapsedText: string) : FoldingRange {
        return create(Position.fromArray(start), Position.fromArray(end), kind, collapsedText);
    }
    export function fromLspFoldingRange(range: LSP.FoldingRange) : FoldingRange {
        let { start, end } = Range.fromArray([[range.startLine, range.startCharacter || -1], [range.endLine, range.endCharacter || -1]]);
        return create(
            start, 
            end,
            range.kind || '',
            range.collapsedText || '',
        );
    }
    export function equals(a: FoldingRange, b: FoldingRange) : boolean {
        return (
            Position.equals(a.start, b.start) &&
            Position.equals(a.end, b.end) &&
            a.kind === b.kind &&
            a.collapsedText === b.collapsedText
        );
    }
}

//
// URI -> mocking for vscode-uri
//
export namespace URI {
    export type Opts = {
        function?: boolean,
        completion?: boolean,
        share?: boolean,
        config?: boolean,
    }
    const DefaultOpts = {
        config: true,
    }
    const configPath = `${homedir()}/.config/fish`;
    const sharePath = `/usr/share/fish`;
    const appendFiletype = (name: string) => {
        if (name.endsWith('.fish')) return name;
        else return `${name}.fish`;
    }
    export function asConfigPath(name: string) : string {
        return `${configPath}/${appendFiletype(name)}`;
    }
    export function asConfigUri(name: string) : string {
        return pathToUri(`${configPath}/${appendFiletype(name)}`)
    }
    export function asSharePath(name: string) : string {
        return `${sharePath}/${appendFiletype(name)}`;
    }
    export function asShareUri(name: string) : string {
        return pathToUri(`${sharePath}/${appendFiletype(name)}`)
    }
    export function createConfigFunctionUri(name: string) : string {
        return asConfigUri(`functions/${name}`);
    }
    export function createConfigCompletionUri(name: string) : string {
        return asConfigUri(`completions/${name}`);
    }
    export function createShareFunctionUri(name: string) : string {
        return asShareUri(`functions/${name}`);
    }
    export function createShareCompletionUri(name: string) : string {
        return asShareUri(`completions/${name}`);
    }
    export function createUri(name: string, opts: Opts = DefaultOpts) : string {
        if (opts.function) {
            if (opts.config) return createConfigFunctionUri(name);
            else if (opts.share) return createShareFunctionUri(name);
        } else if (opts.completion) {
            if (opts.config) return createConfigCompletionUri(name);
            else if (opts.share) return createShareCompletionUri(name);
        } else {
            if (opts.config) return asConfigUri(name);
            else if (opts.share) return asShareUri(name);
        }
        return pathToUri(name);
    }
    export function createPath(name: string, opts: Opts = DefaultOpts) : string {
        if (opts.function) {
            if (opts.config) return asConfigPath(`functions/${name}`);
            else if (opts.share) return asSharePath(`functions/${name}`);
        } else if (opts.completion) {
            if (opts.config) return asConfigPath(`completions/${name}`);
            else if (opts.share) return asSharePath(`completions/${name}`);
        } else {
            if (opts.config) return asConfigPath(name);
            else if (opts.share) return asSharePath(name);
        }
        return uriToPath(name);
    }
}

// 
// NODE -> mocking for SyntaxNode
//
export interface Node {
    text: string,
    type: string,
    startRange: [number, number],
    endRange: [number, number],
    children: Node[],
}
export namespace Node {
    export function fromSyntaxNode(node: SyntaxNode) : Node {
        return {
            text: node.text,
            type: node.type,
            startRange: [node.startPosition.row, node.startPosition.column],
            endRange: [node.endPosition.row, node.endPosition.column],
            children: node.children.map(fromSyntaxNode),
        }
    }
    export function create(text: string, type: string, start: [number, number], end: [number, number], children: Node[]) : Node {
        return {
            text: text,
            type: type,
            startRange: start,
            endRange: end,
            children: children,
        }
    }

    export function debugSyntaxNode(node: SyntaxNode) : string {
        const shortLog = (node: SyntaxNode) => {
            return `{text: '${node.text}', type: '${node.type}'}`
        }

        let result = {
            id: node.id,
            text: node.text,
            type: node.type,
            range: Range.toString(Range.fromRange(getRange(node))),
            children: '[ ' + node.children.map(n => shortLog(n)).join(',') + ' ]',
            index: `start:${node.startIndex}, end:${node.endIndex}`,
        }

        const setKey = (value: string) => {
            return {...result, value}
        }


        if ( node.previousSibling ) result = setKey(shortLog(node.previousSibling));
        if ( node.previousNamedSibling ) result = setKey(shortLog(node.previousNamedSibling));
        if ( node.nextSibling ) result = setKey(shortLog(node.nextSibling));
        if ( node.nextNamedSibling ) result = setKey(shortLog(node.nextNamedSibling));
        if ( node.firstChild ) result = setKey(shortLog(node.firstChild));
        if ( node.lastChild ) result = setKey(shortLog(node.lastChild));
        if ( node.firstNamedChild ) result = setKey(shortLog(node.firstNamedChild));
        if ( node.lastNamedChild ) result = setKey(shortLog(node.lastNamedChild));

        return JSON.stringify(result, null, 2)
    }



}