import { SymbolKind, WorkspaceSymbol, Range, DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { CommentRange, symbolKindToString, toSymbolKind } from '../symbols';
import { isDefinition, isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition } from './node-types';
import { uriToPath } from './translation';
import { getChildNodes, getRange } from './tree-sitter';


export interface FishWorkspaceSymbol extends WorkspaceSymbol {
    name: string
    kind: SymbolKind
    location: {
        uri: string
        range:  Range
    },
    documentation: {
        text: string
        markdown: string
    }
}

export namespace FishWorkspaceSymbol {
    export function create(name: string, kind: SymbolKind, uri: string, range: Range, markdown: string): FishWorkspaceSymbol {
        return {
            name: name,
            kind: kind,
            location: {
                uri: uri,
                range: range,
            },
            documentation: {
                text: [
                    `${symbolKindToString(kind).toLowerCase()} ${name}`,
                    `defined in file: '${uriToPath(uri)}'`,
                ].join("\n"),
                markdown: markdown,
            },
        };
    }
}

export namespace MarkdownDocumentation {
    export function create(node: SyntaxNode, uri: string): string {
        const path = uriToPath(uri) || uri
        const commentRange = CommentRange.create(node)
        if (isFunctionDefinitionName(node)) {
            return [
                `\*(function)* \**${node.text}**`,
                `defined in file: '${path}'`,
                '___',
                commentRange.markdown()
            ].join('\n')
        } else if (isVariableDefinition(node)) {
            const parentNode = node.parent || node
            const withCommentText = isFunctionDefinition(parentNode) ? parentNode.text.toString() : commentRange.text()
            return [
                `\*(variable)* \**${node.text}**`,
                `defined in file: '${path}'`,
                "___",
                "```fish",
                `${withCommentText.trim()}`,
                "```",
            ].join("\n")
        }
        return [
            "```fish",
            node.text,
            "```"
        ].join('\n');
    }
}

export function collectFishWorkspaceSymbols(uri: DocumentUri, root: SyntaxNode) : FishWorkspaceSymbol[] {
    const symbols: FishWorkspaceSymbol[] = [];
    const nodes = getChildNodes(root).filter(node => isDefinition(node));
    for (const node of nodes) {
        const name = node.text;
        const kind = toSymbolKind(node);
        const range = getRange(node);
        const docs = MarkdownDocumentation.create(node, uri);
        const symbol = FishWorkspaceSymbol.create(name, kind, uri, range, docs);
        symbols.push(symbol);
    }
    return symbols;
}

