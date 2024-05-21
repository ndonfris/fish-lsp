import os from 'os';
import { SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition, isProgram, isVariableDefinitionName } from './node-types';
//import { FishFlagOption, optionTagProvider } from './options';
import { symbolKindToString, pathToRelativeFunctionName, uriToPath } from './translation';

/**
 * Current CHANGELOG for documentation:
 *     • functions with preceding spaces between their comments keep whitespace between
 *        the comments and the function definition
 *     • @see zoom_out.fish and yarn_reset.fish
 *            -    ~/.config/fish/functions/yarn_reset.fish (shows whole program)
 *
 *                  ** SHOULD NOW BE WORKING AS OF 3/15/2023 **
 *                     consider moving this to a singular function call or something?
 *                     It's over complicated, a single function would have an easier
 *                     control flow to follow instead of the setters seen below and the
 *                     toString() function that builds the entire object.
 *
 *            -    ~/.config/fish/functions/zoom_out.fish (shows whitespace mentioned in previous bullet point)
 */

export class DocumentationStringBuilder {
  constructor(
    private name: string = name,
    private uri: string = uri,
    private kind: SymbolKind = kind,
    private inner: SyntaxNode = inner,
    //private outer = inner.parent || inner.previousSibling || null,
    // removed
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

  /** ~/.config/fish/functions/yarn_reset.fish
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

  get shortenendUri(): string {
    const uriPath = uriToPath(this.uri)!;
    return uriPath.replace(os.homedir(), '~');
  }

  // add this.tagString once further implemented
  toString() {
    //const optionTags = optionTagProvider(this.inner, this.outer);
    //const tagsText = optionTags.map((tag) => tag.toString()).join("\n");
    return [
      `\*(${symbolKindToString(this.kind)})* \**${this.name}**`,
      `defined in file: '${this.shortenendUri}'`,
      '___',
      '```fish',
      this.text,
      '```',
    ].join('\n');
  }
}

export namespace DocumentSymbolDetail {
  export function create(name: string, uri: string, kind: SymbolKind, inner: SyntaxNode, outer: SyntaxNode | null = inner.parent || inner.previousSibling || null): string {
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
