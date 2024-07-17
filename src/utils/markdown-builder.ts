import { MarkupContent, MarkupKind } from 'vscode-languageserver';

export namespace md {

  export function h(text: string, value: number = 1) {
    return '#'.repeat(value) + ' ' + text.trim();
  }

  export function italic(value: string) {
    return '*' + value + '*';
  }

  export function bold(value: string) {
    return '**' + value + '**';
  }

  export function boldItalic(value: string) {
    return '***' + value + '***';
  }

  export function separator() {
    return '___' + newline();
  }

  export function space() {
    return ' ';
  }

  export function newline() {
    return '\n';
  }

  export function blockQuote(value: string) {
    return '> ' + value;
  }

  export function inlineCode(value: string) {
    return '`' + value + '`';
  }

  export function codeBlock(language: string, value: string): string {
    return [
      '```' + language,
      value,
      '```',
    ].join('\n');
  }

  export function li(value: string) {
    return '- ' + value;
  }

  export function ol(value: string) {
    return '1.' + value;
  }

  export function link(name: string, href: string) {
    return `[${name}](${href})`;
  }

  export function filepathString(value: string) {
    return escapeMarkdownSyntaxTokens(value);
  }

  export function p(...strs: string[]) {
    return strs.join(space());
  }

}

//  https://github.com/typescript-language-server/typescript-language-server/blob/master/src/utils/MarkdownString.ts

export const enum MarkdownStringTextNewlineStyle {
  Paragraph = 0,
  Break = 1,
}

export class MarkdownBuilder {
  constructor(public value = '') {}

  appendText(value: string, newlineStyle: MarkdownStringTextNewlineStyle = MarkdownStringTextNewlineStyle.Paragraph): MarkdownBuilder {
    this.value += escapeMarkdownSyntaxTokens(value)
      .replace(/([ \t]+)/g, (_match, g1) => '&nbsp;'.repeat(g1.length))
      .replace(/>/gm, '\\>')
      .replace(/\n/g, newlineStyle === MarkdownStringTextNewlineStyle.Break ? '\\\n' : '\n\n');

    return this;
  }

  appendNewline(): MarkdownBuilder {
    this.value += md.newline();
    return this;
  }

  fromMarkdown(...values: (string | string[])[]): MarkdownBuilder {
    this.value += values.map(item =>
      Array.isArray(item) ? item.map(i => i.trim()).join(' ') : item.trim(),
    ).join('\n');
    return this;
  }

  appendMarkdown(value: string): MarkdownBuilder {
    this.value += value;
    return this;
  }

  appendCodeblock(langId: string, code: string): MarkdownBuilder {
    this.value += '\n```';
    this.value += langId;
    this.value += '\n';
    this.value += code;
    this.value += '\n```\n';
    return this;
  }

  toMarkupContent(): MarkupContent {
    return {
      kind: MarkupKind.Markdown,
      value: this.value,
    };
  }

  toString() {
    return this.value;
  }
}

export function escapeMarkdownSyntaxTokens(text: string): string {
  // escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
  return text.replace(/[\\`*_{}[\]()#+\-!]/g, '\\$&');
}