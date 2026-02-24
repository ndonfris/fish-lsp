/**
 * Regression tests for issue #140:
 *   https://github.com/ndonfris/fish-lsp/issues/140
 *
 * Problem:
 *   `complete -c 'mas' -f` in `completions/mas.fish` produces a false-positive
 *   diagnostic 4005 ("Autoloaded completion missing command name") because the
 *   validator compared the raw node text (e.g. `'mas'`, `"mas"`, `\mas`) directly
 *   against the filename stem (`mas`), without stripping quotes or escape sequences.
 *
 * All of the following representations of `mas` must be recognized as equivalent
 * when used as the `-c` argument in a `complete` command:
 *
 *   mas       → unquoted word
 *   'mas'     → single-quoted string
 *   "mas"     → double-quoted string
 *   \mas      → backslash-escaped first character
 *   \ma\s     → backslash-escaped first and last characters
 *   ma\s      → backslash-escaped last character
 */

import Parser from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { Analyzer, analyzer } from '../src/analyze';
import { createFakeLspDocument, createMockConnection } from './helpers';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { config } from '../src/config';
import { logger } from '../src/logger';
import { connection } from '../src/utils/startup';
import FishServer from '../src/server';
import { InitializeParams } from 'vscode-languageserver';
import { setupProcessEnvExecFile } from '../src/utils/process-env';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const COMMAND_NAME = 'mas';

/**
 * Every fish-shell representation of the bare string `mas`.
 * Each entry drives both the unit tests (node shape) and the integration tests
 * (no false-positive diagnostic 4005).
 *
 * Node type notes (from tree-sitter-fish grammar):
 *   - Pure unquoted words → `word`
 *   - Single-quoted strings → `single_quote_string`
 *   - Double-quoted strings → `double_quote_string`
 *   - Words that mix escape sequences with regular chars → `concatenation`
 *     e.g. `\mas` = escape_sequence(`\m`) + word(`as`) = concatenation
 */
const MAS_REPRESENTATIONS: { input: string; description: string; nodeType: string; }[] = [
  { input: 'mas', description: 'unquoted word', nodeType: 'word' },
  { input: "'mas'", description: 'single-quoted string', nodeType: 'single_quote_string' },
  { input: '"mas"', description: 'double-quoted string', nodeType: 'double_quote_string' },
  { input: '\\mas', description: 'backslash before first character', nodeType: 'concatenation' },
  { input: '\\ma\\s', description: 'backslash before first and last chars', nodeType: 'concatenation' },
  { input: 'ma\\s', description: 'backslash before last character', nodeType: 'concatenation' },
];

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('issue #140 – complete -c with quoted/escaped command names', () => {
  let parser: Parser;

  beforeAll(async () => {
    parser = await initializeParser();
    await Analyzer.initialize();
    createMockConnection();
    await FishServer.create(connection, {} as InitializeParams);
    logger.setSilent();
    await setupProcessEnvExecFile();
  });

  beforeEach(() => {
    // Suppress diagnostics that are unrelated to the issue under test so they
    // don't mask the signal we care about.
    config.fish_lsp_diagnostic_disable_error_codes = [
      ErrorCodes.unknownCommand,                  // 7001 – `mas` is not a real command
      ErrorCodes.requireAutloadedFunctionHasDescription, // 4008 – description not under test
    ];
  });

  afterEach(() => {
    config.fish_lsp_diagnostic_disable_error_codes = [];
  });

  // -------------------------------------------------------------------------
  // Unit tests: tree-sitter node shape
  // -------------------------------------------------------------------------

  describe('unit: tree-sitter parses each representation correctly', () => {
    /**
     * For each input, verify:
     *   1. The source parses without a tree-sitter error.
     *   2. The argument node after `-c` carries the expected raw text.
     *   3. The node type matches what fish-lsp's `isString()` would evaluate.
     */
    for (const { input, description, nodeType } of MAS_REPRESENTATIONS) {
      it(`"${input}" (${description}) – raw text and node type`, () => {
        const source = `complete -c ${input} -f`;
        const tree = parser.parse(source);

        // Locate the `complete` command node.
        const commandNode = tree.rootNode.children.find((n: Parser.SyntaxNode) => n.type === 'command');
        expect(commandNode).toBeDefined();

        // Walk the children to find the argument that immediately follows `-c`.
        const children = commandNode!.children;
        const dashCIdx = children.findIndex((c: Parser.SyntaxNode) => c.text === '-c');
        expect(dashCIdx).toBeGreaterThan(-1);

        // The argument node is the next sibling after `-c`.
        const argNode = children[dashCIdx + 1];
        expect(argNode).toBeDefined();

        // Raw text must match exactly what was written in the source.
        expect(argNode!.text).toBe(input);

        // Node type determines whether `isString()` returns true/false.
        expect(argNode!.type).toBe(nodeType);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Integration tests: no false-positive diagnostic 4005
  // -------------------------------------------------------------------------

  describe('integration: no false-positive 4005 for completions/mas.fish', () => {
    /**
     * The golden rule: any valid fish representation of `mas` used as
     * `complete -c <rep> …` inside `completions/mas.fish` must NOT produce
     * diagnostic 4005 ("Autoloaded completion missing command name").
     */
    for (const { input, description } of MAS_REPRESENTATIONS) {
      it(`complete -c ${input} -f → no 4005 (${description})`, async () => {
        const doc = createFakeLspDocument(
          `completions/${COMMAND_NAME}.fish`,
          `complete -c ${input} -f`,
        );
        const cached = analyzer.analyze(doc);
        const diagnostics = await getDiagnosticsAsync(cached.root!, doc);

        const falsePositives = diagnostics.filter(
          d => d.code === ErrorCodes.autoloadedCompletionMissingCommandName,
        );
        expect(falsePositives).toHaveLength(0);
      });
    }

    it('multiple representations in one file → no 4005 for any of them', async () => {
      const lines = MAS_REPRESENTATIONS.map(({ input }) => `complete -c ${input} -f`);
      const doc = createFakeLspDocument(
        `completions/${COMMAND_NAME}.fish`,
        ...lines,
      );
      const cached = analyzer.analyze(doc);
      const diagnostics = await getDiagnosticsAsync(cached.root!, doc);

      const falsePositives = diagnostics.filter(
        d => d.code === ErrorCodes.autoloadedCompletionMissingCommandName,
      );
      expect(falsePositives).toHaveLength(0);
    });

    // Sanity-check: a genuinely mismatched command name MUST still fire 4005.
    it('complete -c other_command -f → DOES produce 4005 (negative control)', async () => {
      const doc = createFakeLspDocument(
        `completions/${COMMAND_NAME}.fish`,
        'complete -c other_command -f',
      );
      const cached = analyzer.analyze(doc);
      const diagnostics = await getDiagnosticsAsync(cached.root!, doc);

      const code4005 = diagnostics.filter(
        d => d.code === ErrorCodes.autoloadedCompletionMissingCommandName,
      );
      expect(code4005.length).toBeGreaterThan(0);
    });
  });
});
