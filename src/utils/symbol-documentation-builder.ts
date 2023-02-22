
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition } from './node-types'
import { FishFlagOption, optionTagProvider } from './options';

export class DocumentationStringBuilder {
    constructor(private inner: SyntaxNode = inner, private outer = inner.parent || inner.previousSibling || null) { }

    get tagsString(): string {
        return optionTagProvider(this.inner, this.outer).map(tag => {
            return tag.toString();
        }).join('\n');
    }

    private get precedingComments(): string {
        if (hasPrecedingFunctionDefinition(this.inner) && isVariableDefinition(this.inner)) {
            return this.outer?.firstNamedChild?.text + ' ' + this.inner.text
        }
        return getPrecedingCommentString(this.outer || this.inner);
    }

    get text(): string {
        const text = this.precedingComments;
        const lines = text.split('\n');
        if (lines.length > 1 && this.outer) {
            const lastLine = this.outer.lastChild?.startPosition.column || 0;
            return lines.map(line => line.replace(' '.repeat(lastLine), '')).join('\n');
        }
        return text;
    }

    toString() {
        const optionTags =  optionTagProvider(this.inner, this.outer)
        const tagsText =  optionTags.map(tag => tag.toString()).join('\n')
        return [
            this.tagsString,
            '---',
            '```fish',
            this.text,
            '```'
        ].join('\n');
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


