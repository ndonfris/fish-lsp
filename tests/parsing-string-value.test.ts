/**
 * Unit tests for `FishString` (src/parsing/string.ts)
 *
 * Verifies that every fish-shell surface representation of the string `mas`
 * is reduced to the bare value `"mas"` by `FishString.fromNode` and `FishString.fromText`.
 *
 * Input forms tested (from issue #140):
 *   mas       – plain unquoted word            (node type: word)
 *   'mas'     – single-quoted string           (node type: single_quote_string)
 *   "mas"     – double-quoted string           (node type: double_quote_string)
 *   \mas      – backslash before first char    (node type: concatenation)
 *   \ma\s     – backslash before first & last  (node type: concatenation)
 *   ma\s      – backslash before last char     (node type: concatenation)
 *
 * @see https://github.com/ndonfris/fish-lsp/issues/140
 */

import Parser from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { FishString } from '../src/parsing/string';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let parser: Parser;

/**
 * Returns the SyntaxNode for the argument that immediately follows `-c` in
 * `complete -c <input> -f`.
 */
function getCommandArgNode(input: string): Parser.SyntaxNode {
  const source = `complete -c ${input} -f`;
  const tree = parser.parse(source);
  const commandNode = tree.rootNode.children.find(
    (n: Parser.SyntaxNode) => n.type === 'command',
  );
  if (!commandNode) throw new Error(`No command node found in: ${source}`);
  const children = commandNode.children;
  const dashCIdx = children.findIndex((c: Parser.SyntaxNode) => c.text === '-c');
  if (dashCIdx === -1) throw new Error(`No -c flag found in: ${source}`);
  const argNode = children[dashCIdx + 1];
  if (!argNode) throw new Error(`No argument after -c in: ${source}`);
  return argNode;
}

// ---------------------------------------------------------------------------
// FishString.fromNode
// ---------------------------------------------------------------------------

describe('FishString.fromNode – issue #140 input cases', () => {
  beforeAll(async () => {
    parser = await initializeParser();
  });

  const cases: { input: string; description: string; }[] = [
    { input: 'mas', description: 'unquoted word' },
    { input: "'mas'", description: 'single-quoted string' },
    { input: '"mas"', description: 'double-quoted string' },
    { input: '\\mas', description: 'backslash before first character' },
    { input: '\\ma\\s', description: 'backslash before first and last chars' },
    { input: 'ma\\s', description: 'backslash before last character' },
  ];

  for (const { input, description } of cases) {
    it(`FishString.fromNode("${input}") === "mas"  [${description}]`, () => {
      const node = getCommandArgNode(input);
      expect(FishString.fromNode(node)).toBe('mas');
    });
  }
});

// ---------------------------------------------------------------------------
// FishString.fromText – string-only variant (no SyntaxNode needed)
// ---------------------------------------------------------------------------

describe('FishString.fromText – issue #140 input cases (string-only variant)', () => {
  const cases: { input: string; description: string; }[] = [
    { input: 'mas', description: 'unquoted word' },
    { input: "'mas'", description: 'single-quoted string' },
    { input: '"mas"', description: 'double-quoted string' },
    { input: '\\mas', description: 'backslash before first character' },
    { input: '\\ma\\s', description: 'backslash before first and last chars' },
    { input: 'ma\\s', description: 'backslash before last character' },
  ];

  for (const { input, description } of cases) {
    it(`FishString.fromText("${input}") === "mas"  [${description}]`, () => {
      expect(FishString.fromText(input)).toBe('mas');
    });
  }

  it('resolves \\n to newline', () => {
    expect(FishString.fromText('\\n')).toBe('\n');
  });

  it('resolves \\t to tab', () => {
    expect(FishString.fromText('\\t')).toBe('\t');
  });

  it('resolves \\\\ to a single backslash', () => {
    expect(FishString.fromText('\\\\')).toBe('\\');
  });

  it('strips single quotes from quoted string', () => {
    expect(FishString.fromText("'hello world'")).toBe('hello world');
  });

  it('strips double quotes from quoted string', () => {
    expect(FishString.fromText('"hello world"')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// FishString.parse – convenience overload (SyntaxNode | string)
// ---------------------------------------------------------------------------

describe('FishString.parse – dispatches to fromNode or fromText based on input type', () => {
  beforeAll(async () => {
    parser = await initializeParser();
  });

  it('accepts a plain string and strips single quotes', () => {
    expect(FishString.parse("'mas'")).toBe('mas');
  });

  it('accepts a plain string and strips double quotes', () => {
    expect(FishString.parse('"mas"')).toBe('mas');
  });

  it('accepts a plain string and resolves escape sequences', () => {
    expect(FishString.parse('\\mas')).toBe('mas');
  });

  it('accepts a plain string unquoted — returns as-is', () => {
    expect(FishString.parse('mas')).toBe('mas');
  });

  it('accepts a SyntaxNode (word) and returns its text', () => {
    const node = getCommandArgNode('mas');
    expect(FishString.parse(node)).toBe('mas');
  });

  it('accepts a SyntaxNode (single_quote_string) and strips quotes', () => {
    const node = getCommandArgNode("'mas'");
    expect(FishString.parse(node)).toBe('mas');
  });

  it('accepts a SyntaxNode (concatenation) and resolves escapes', () => {
    const node = getCommandArgNode('\\mas');
    expect(FishString.parse(node)).toBe('mas');
  });

  it('produces the same result as fromText when given a string', () => {
    const inputs = ['mas', "'mas'", '"mas"', '\\mas', '\\ma\\s', 'ma\\s'];
    for (const input of inputs) {
      expect(FishString.parse(input)).toBe(FishString.fromText(input));
    }
  });

  it('produces the same result as fromNode when given a SyntaxNode', () => {
    const inputs = ['mas', "'mas'", '"mas"', '\\mas', '\\ma\\s', 'ma\\s'];
    for (const input of inputs) {
      const node = getCommandArgNode(input);
      expect(FishString.parse(node)).toBe(FishString.fromNode(node));
    }
  });
});
