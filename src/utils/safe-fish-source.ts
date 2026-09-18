import { SyntaxNode } from 'web-tree-sitter';

/** `text` as a fish single-quoted literal (inside one, only `\\` and `\'` are escapes) */
export function fishLiteral(text: string): string {
  return `'${text.replace(/[\\']/g, '\\$&')}'`;
}

/** only reads a variable: `$v`, `$$v`, `$v[1]`, `$v[-1..$n]` (no `$v[(cmd)]`) */
const PLAIN_VARIABLE = /^\$+\w+(\[[ \w.$-]*\])?$/;
/** `~`, `~user` */
const HOME_DIR = /^~[\w.-]*$/;
/** a `\` escaping one character, a `\`+newline continuation, or `\x41`, `\u00e9`, … */
const SIMPLE_ESCAPE = /^\\([^\r\n]|\r?\n|[A-Za-z0-9]+)$/;

/** `node`'s children, with the source text between them as strings */
export function childrenWithGaps(node: SyntaxNode): (SyntaxNode | string)[] {
  const parts: (SyntaxNode | string)[] = [];
  let offset = 0;
  for (const child of node.children) {
    const start = child.startIndex - node.startIndex;
    if (start > offset) parts.push(node.text.slice(offset, start));
    parts.push(child);
    offset = Math.max(offset, child.endIndex - node.startIndex);
  }
  if (offset < node.text.length) parts.push(node.text.slice(offset));
  return parts;
}

/**
 * Fish source for an argument from a document, rebuilt from its syntax tree so that
 * fish can expand it (to preview it, or to use its value) but can never run anything.
 * Only brace syntax, plain variables, `~` and simple escapes stay live. Everything
 * else is a quoted literal of its source text: words (a glob can't match files),
 * command substitutions (they can't run) and anything a syntax error left behind (a
 * misparse can't expose code to fish).
 *
 * `x(rm foo)*{a,b}` → `'x''(rm foo)''*'{'a','b'}` → `x(rm foo)*a`, `x(rm foo)*b`
 */
export function safeFishSource(node: SyntaxNode | string): string {
  // the source between two nodes: indentation after a `\`+newline, else never valid
  if (typeof node === 'string') return /^[ \t]*$/.test(node) ? node : fishLiteral(node);
  switch (node.type) {
    case 'concatenation':
    case 'brace_expansion':
      return childrenWithGaps(node).map(safeFishSource).join('');
    case '{':
    case ',':
    case '}':
      if (!node.isNamed && node.parent?.type === 'brace_expansion') return node.type;
      break;
    case 'variable_expansion':
      if (PLAIN_VARIABLE.test(node.text)) return node.text;
      break;
    case 'home_dir_expansion':
      if (HOME_DIR.test(node.text)) return node.text;
      break;
    case 'escape_sequence':
      if (SIMPLE_ESCAPE.test(node.text)) return node.text;
      break;
    case 'single_quote_string':
      return fishLiteral(node.text.replace(/^'|'$/g, '').replace(/\\([\\'])/g, '$1'));
    case 'double_quote_string':
      return doubleQuotedSafeSource(node);
  }
  return fishLiteral(node.text);
}

/**
 * `"pre$HOME$(cmd)\""` → `'pre'"$HOME"'$(cmd)''"'`: adjacent pieces that fish still
 * joins into one item, where only the plain variables are live, each in its own `"…"`
 */
function doubleQuotedSafeSource(node: SyntaxNode): string {
  const pieces = childrenWithGaps(node).map(part => {
    if (typeof part === 'string') return fishLiteral(part);
    if (!part.isNamed) return ''; // the `"`s
    if (part.type === 'variable_expansion' && PLAIN_VARIABLE.test(part.text)) return `"${part.text}"`;
    if (part.type === 'escape_sequence') {
      // in `"…"` fish only unescapes `\"` `\$` `\\` and `\`+newline; any other `\` is kept
      if (/^\\\r?\n$/.test(part.text)) return '';
      return fishLiteral(/^\\["$\\]$/.test(part.text) ? part.text[1]! : part.text);
    }
    return fishLiteral(part.text);
  });
  return pieces.join('') || "''";
}
