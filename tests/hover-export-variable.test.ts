import { analyzer } from '../src/analyze';
import { createTestServer, setLogger, TestServerHandle } from './helpers';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { documents } from '../src/document';
import * as LSP from 'vscode-languageserver';

setLogger();

/**
 * Regression coverage for hovering a variable defined via `export NAME=value`.
 *
 * Two bugs were producing broken hovers here:
 *   1. `buildExportDetail()` passed the bare `NAME=` name token to
 *      `extractExportVariable()`, which reads the command's `argument` field —
 *      the name token has none, so the detail came back empty and every `$NAME`
 *      reference hovered to an empty string ("no hover at all").
 *   2. `onHover()` treated the `NAME=` definition name (a `word` inside a
 *      `concatenation`) as a brace/concatenation value, showing the expansion
 *      preview instead of the variable definition.
 */
describe('hover for `export NAME=value` variables', () => {
  let handle: TestServerHandle;
  const SRC = [
    '$PATH', // 0 - reference before definition
    'echo "$PATH[1]"', // 1 - reference inside a quoted string with index
    '', // 2
    'export PATH="/bin:$PATH"', // 3 - definition + self-reference in value
    'alias foo=bar', // 4
    'ls --accessed $PATH', // 5 - reference as a command argument (option value)
  ].join('\n') + '\n';

  const ws = TestWorkspace.create().addFiles(TestFile.config(SRC)).initialize();

  beforeAll(async () => {
    handle = await createTestServer();
    ws.workspace!.uris.all.forEach(uri => {
      const doc = documents.get(uri);
      if (doc) analyzer.analyze(doc);
    });
  });
  afterAll(async () => {
    await handle.shutdown();
  });

  async function hoverValue(line: number, character: number): Promise<string | null> {
    const doc = ws.find('config.fish')!;
    analyzer.analyze(doc);
    const hover = await handle.server.onHover({
      textDocument: { uri: doc.uri },
      position: { line, character },
    } as LSP.HoverParams);
    if (!hover || !('contents' in hover)) return null;
    return String((hover.contents as LSP.MarkupContent).value ?? '');
  }

  const referencePositions: Array<[number, number, string]> = [
    [0, 1, 'bare `$PATH` statement before the definition'],
    [1, 7, '`$PATH` inside a quoted string with an index'],
    [3, 19, '`$PATH` self-reference inside the export value'],
    [5, 15, '`$PATH` as the value of `ls --accessed`'],
  ];

  it.each(referencePositions)(
    'shows the variable definition hover for %s',
    async (line, character) => {
      const value = await hoverValue(line, character);
      expect(value).toBeTruthy();
      expect(value).toContain('(**variable**)');
      expect(value).toContain('`PATH`');
      expect(value).toContain('exported');
      // The title line must be followed by a separator, matching the shape of a
      // normal `set -gx` variable hover.
      expect(value).toMatch(/\(\*\*variable\*\*\) `PATH`\s*\n___/);
      // Known special variables (PATH) include their prebuilt description, just
      // like the `set -gx PATH` hover.
      expect(value).toContain('A list of directories in which to search for commands');
    },
  );

  it('shows the variable definition hover on the `PATH=` definition name (not a concatenation preview)', async () => {
    const value = await hoverValue(3, 7);
    expect(value).toBeTruthy();
    expect(value).toContain('(**variable**)');
    expect(value).toContain('`PATH`');
    // It must NOT fall back to the brace/concatenation expansion preview.
    expect(value).not.toContain('|`PATH=/');
  });
});
