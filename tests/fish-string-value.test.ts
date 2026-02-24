/**
 * Unit tests for `getFishStringValue` (src/utils/translation.ts)
 *
 * Verifies that every fish-shell surface representation of the string `mas`
 * is reduced to the bare value `"mas"` by the utility function.
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
import { getFishStringValue } from '../src/utils/translation';

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
// Suite
// ---------------------------------------------------------------------------

describe('getFishStringValue – issue #140 input cases', () => {
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
    it(`getFishStringValue("${input}") === "mas"  [${description}]`, () => {
      const node = getCommandArgNode(input);
      expect(getFishStringValue(node)).toBe('mas');
    });
  }
});
