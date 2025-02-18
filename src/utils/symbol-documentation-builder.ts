import os from 'os';
import { SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isVariableDefinition, isProgram, isVariableDefinitionName } from './node-types';
//import { FishFlagOption, optionTagProvider } from './options';
import { symbolKindToString, uriToPath } from './translation';
import { MarkdownBuilder, md } from './markdown-builder';
import { PrebuiltDocumentationMap } from './snippets';

/**
 * Current CHANGELOG for documentation:
 *     • functions with preceding spaces between their comments keep whitespace between
 *        the comments and the function definition
 *     • @see zoom_out.fish and yarn_reset.fish
 *            -    ~/.config/fish/functions/yarn_reset.fish (shows whole program)
 */

export class DocumentationStringBuilder {
  constructor(
    private name: string = name,
    private uri: string = uri,
    private kind: SymbolKind = kind,
    private inner: SyntaxNode = inner,
    //private outer = inner.parent || inner.previousSibling || null,
  ) {}

  private get outer() {
    if (isFunctionDefinitionName(this.inner) || isVariableDefinitionName(this.inner)) {
      return this.inner.parent;
    }
    return this.inner.previousSibling || null;
  }

  //get tagsString(): string {
  //    return optionTagProvider(this.inner, this.outer)
  //        .map((tag) => {
  //            return tag.toString();
  //        })
  //        .join("\n");
  //}

  /**
   * ~/.config/fish/functions/yarn_reset.fish
   *  causes error, shows entire file instead of just function
   *  meaning that the outer node is being used when it shouldn't be
   */
  private get precedingComments(): string {
    if (this.outer && isProgram(this.outer)) {
      return getPrecedingCommentString(this.inner);
    }
    if (
      hasPrecedingFunctionDefinition(this.inner) &&
            isVariableDefinition(this.inner)
    ) {
      return this.outer?.firstNamedChild?.text + ' ' + this.inner.text;
    }
    return getPrecedingCommentString(this.outer || this.inner);
  }

  get text(): string {
    const text = this.precedingComments;
    const lines = text.split('\n');
    if (lines.length > 1 && this.outer) {
      const lastLine = this.outer.lastChild?.startPosition.column || 0;
      return lines
        .map((line) => line.replace(' '.repeat(lastLine), ''))
        .join('\n')
        .trimEnd();
    }
    return text;
  }

  get shortenedUri(): string {
    const uriPath = uriToPath(this.uri)!;
    return uriPath.replace(os.homedir(), '~');
  }

  // add this.tagString once further implemented
  toString() {
    //const optionTags = optionTagProvider(this.inner, this.outer);
    //const tagsText = optionTags.map((tag) => tag.toString()).join("\n");
    const symbolString = symbolKindToString(this.kind);
    const prebuiltType = symbolString === 'function' ? 'command' : 'variable';
    const prebuiltMatch = PrebuiltDocumentationMap.getByType(prebuiltType)
      .find(({ name }) => name === this.name);
    const info = prebuiltMatch?.description ?
      [
        `defined in file: ${this.shortenedUri}`,
        md.separator(),
        prebuiltMatch.description,
      ].join('\n')
      : `defined in file: ${this.shortenedUri}`;

    return new MarkdownBuilder()
      .fromMarkdown(
        [
          `(${md.italic(symbolString)})`, md.bold(this.name)],
        info,
        md.separator(),
        md.codeBlock('fish', this.text),
      )
      .toString();
  }
}

export namespace DocumentSymbolDetail {
  export function create(name: string, uri: string, kind: SymbolKind, inner: SyntaxNode, _outer: SyntaxNode | null = inner.parent || inner.previousSibling || null): string {
    return new DocumentationStringBuilder(name, uri, kind, inner).toString();
  }
}

function getPrecedingCommentString(node: SyntaxNode): string {
  const comments: string[] = [node.text];
  let current: SyntaxNode | null = node.previousNamedSibling;
  while (current && current.type === 'comment') {
    comments.unshift(current.text);
    current = current.previousSibling;
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
