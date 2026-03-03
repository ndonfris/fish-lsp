import { SyntaxNode } from 'web-tree-sitter';

/**
 * Resolves a single fish shell escape sequence token to its character value.
 *
 * In unquoted fish strings `\X` where X is not a recognised special character
 * resolves to just `X`.  Recognised specials follow the standard C/fish
 * convention (`\n`, `\t`, `\e`, `\u`, …).
 *
 * @param seq - raw escape-sequence text, e.g. `\n`, `\m`, `\uXXXX`
 * @returns the resolved character(s)
 */
function unescapeSequence(seq: string): string {
  if (!seq.startsWith('\\') || seq.length < 2) return seq;
  const char = seq[1]!;
  switch (char) {
    case 'a': return '\x07';   // bell
    case 'b': return '\x08';   // backspace
    case 'e': return '\x1B';   // escape
    case 'f': return '\x0C';   // form feed
    case 'n': return '\n';     // newline
    case 'r': return '\r';     // carriage return
    case 't': return '\t';     // tab
    case 'v': return '\x0B';   // vertical tab
    case '\\': return '\\';
    case ' ': return ' ';
    case 'u': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'U': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'x': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'o': {
      const cp = parseInt(seq.slice(2), 8);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'c': {
      const ctrl = seq[2];
      return ctrl ? String.fromCharCode(ctrl.toUpperCase().charCodeAt(0) - 64) : seq;
    }
    default:
      // Any other \X → X  (backslash is simply dropped)
      return char;
  }
}

/**
 * Utilities for extracting the bare string value from any fish shell string
 * surface form — quoted, escaped, or plain.
 *
 * Fish strings can appear in multiple forms that all denote the same value:
 *
 *   `mas`       → `word` node / plain text     → `"mas"`
 *   `'mas'`     → `single_quote_string` node   → `"mas"`
 *   `"mas"`     → `double_quote_string` node   → `"mas"`
 *   `\mas`      → `concatenation` node         → `"mas"`
 *   `\ma\s`     → `concatenation` node         → `"mas"`
 *   `ma\s`      → `concatenation` node         → `"mas"`
 *
 * @see https://github.com/ndonfris/fish-lsp/issues/140
 */
export namespace FishString {
  /**
   * Extracts the bare string value from a fish shell SyntaxNode.
   * Strips surrounding quotes and resolves escape sequences.
   */
  export function fromNode(node: SyntaxNode): string {
    switch (node.type) {
      case 'single_quote_string':
      case 'double_quote_string':
        return node.text.slice(1, -1);
      case 'concatenation':
        return node.children
          .map(child =>
            child.type === 'escape_sequence'
              ? unescapeSequence(child.text)
              : child.text)
          .join('');
      default:
        // Covers plain `word` nodes and any future node types.
        return node.text;
    }
  }

  /**
   * Extracts the bare string value from a raw fish shell text string.
   * Strips surrounding quotes and resolves escape sequences.
   * Use `fromNode` instead when a SyntaxNode is available.
   */
  export function fromText(text: string): string {
    if (text.length >= 2) {
      if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
      if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
    }
    // Resolve escape sequences in unquoted / concatenation-style text.
    // Alternation is ordered longest-first so \uXXXX is matched before the
    // catch-all single-character branch.
    return text.replace(
      /\\(u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|x[0-9a-fA-F]{1,2}|o[0-7]{1,3}|c[a-zA-Z]|[\s\S])/g,
      (seq) => unescapeSequence(seq),
    );
  }

  /**
   * Convenience overload — dispatches to `fromNode` or `fromText` based on
   * the type of `input`.
   */
  export function parse(input: SyntaxNode | string): string {
    return typeof input === 'string' ? fromText(input) : fromNode(input);
  }
}
