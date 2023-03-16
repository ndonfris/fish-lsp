import os from 'os'

import { SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { symbolKindToString } from '../symbols';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition } from './node-types'
import { FishFlagOption, optionTagProvider } from './options';
import { pathToRelativeFunctionName, uriToPath } from './translation';

export class DocumentationStringBuilder {
    constructor(
        private name: string = name,
        private uri: string = uri,
        private kind: SymbolKind = kind,
        private inner: SyntaxNode = inner,
        private outer = inner.parent || inner.previousSibling || null,
    ) {}

    get tagsString(): string {
        return optionTagProvider(this.inner, this.outer)
            .map((tag) => {
                return tag.toString();
            })
            .join("\n");
    }

    // ~/.config/fish/functions/yarn_reset.fish
    // causes error, shows entire file instead of just function
    // meaning that the outer node is being used when it shouldn't be
    private get precedingComments(): string {
        if (
            hasPrecedingFunctionDefinition(this.inner) &&
            isVariableDefinition(this.inner)
        ) {
            return this.outer?.firstNamedChild?.text + " " + this.inner.text;
        }
        return getPrecedingCommentString(this.outer || this.inner);
    }

    get text(): string {
        const text = this.precedingComments;
        const lines = text.split("\n");
        if (lines.length > 1 && this.outer) {
            const lastLine = this.outer.lastChild?.startPosition.column || 0;
            return lines
                .map((line) => line.replace(" ".repeat(lastLine), ""))
                .join("\n")
                .trimEnd();
        }
        return text;
    }

    get shortenendUri(): string {
        const uriPath = uriToPath(this.uri)!;
        return uriPath.replace(os.homedir(), "~");
    }   

    // add this.tagString once further implemented
    toString() {
        const optionTags = optionTagProvider(this.inner, this.outer);
        const tagsText = optionTags.map((tag) => tag.toString()).join("\n");
        return [
            `\*(${symbolKindToString(this.kind)})* \**${this.name}**`,
            `defined in file: '${this.shortenendUri}'`,
            "___",
            "```fish",
            this.text,
            "```"
        ].join("\n");
    }
}

export namespace DocumentSymbolDetail {
    export function create(name: string, uri: string, kind: SymbolKind, inner: SyntaxNode, outer: SyntaxNode | null = inner.parent || inner.previousSibling || null): string {
        return new DocumentationStringBuilder(name, uri, kind, inner, outer).toString();
    }
}

function getPrecedingCommentString(node: SyntaxNode): string {
    const comments: string[] = [node.text];
    let current: SyntaxNode | null = node.previousNamedSibling;
    while (current && current.type === 'comment') {
        comments.unshift(current.text);
        current = current.previousNamedSibling;
    }
    return comments.join('\n');
}

function hasPrecedingFunctionDefinition(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node.previousSibling;
    while (current) {
        if (isFunctionDefinitionName(current)) {
            return true;
        }
        current = current.previousSibling;
    }
    return false;
}

