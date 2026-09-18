import { analyzer } from '../src/analyze';
import { createFakeLspDocument, createTestServer, setLogger, TestServerHandle } from './helpers';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { documents } from '../src/document';
import * as LSP from 'vscode-languageserver';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

setLogger();

/**
 * Hovering anywhere inside a brace/concatenation word previews its expansion.
 *
 * Two bugs hid the preview for a multiline brace (`{\⏎a,\⏎b}`):
 *   1. Each `\`+newline item parses as its own `concatenation(escape_sequence, word)`
 *      inside the `brace_expansion`, and `onHover()` expanded the nearest
 *      `concatenation` — only the `\⏎a` fragment.
 *   2. `expand_cartesian.fish` ran the text through `string unescape` on stdin, which
 *      unescapes line by line, splitting every `\`+newline continuation.
 */
describe('hover for brace expansions', () => {
  let handle: TestServerHandle;
  /** created only if a hover runs one of the `touch` command substitutions below */
  const MARKER = join(mkdtempSync(join(tmpdir(), 'fish-lsp-hover-')), 'ran');
  const SRC = [
    'set -lx var {a,b,c,d}', // 0
    'set -lx var {\\', // 1
    'a,\\', // 2
    'b,\\', // 3
    'c}', // 4
    'echo pre{\\', // 5
    'x,\\', // 6
    'y}post', // 7
    'echo "foo bar"{1,2}', // 8
    'echo {a\\,b,c}', // 9
    `echo x(touch ${MARKER}){a,b}`, // 10
    `echo "pre$(touch ${MARKER})"{a,b}`, // 11
    `echo {a,(touch ${MARKER})}`, // 12
    'echo {a,(echo "q\'x"),$(echo z)}', // 13
    'set -f paths z/{\\', // 14
    '        1/a,\\', // 15
    '            2/b,\\', // 16
    '  3/c}', // 17
    'echo {fish_files/*.fish,fish_files/**,x}', // 18
    `echo $PATH[(touch ${MARKER})]{a,b}`, // 19
    'echo "q\\"\\$x\\\\y$HOME"{a,b}', // 20
    "echo 'it\\'s'{a,b}", // 21
    'echo --foo={a,b}', // 22
    'echo "é$HOME"{1,2}', // 23
    'echo $not_set_z/z/{a,b,c,d}', // 24
    'echo \\$foo/{a,b}', // 25 - escaped `$`, a literal `$foo`
    'echo "\\$foo"/{a,b}', // 26 - escaped `$` inside double quotes
    "echo '$foo'/{a,b}", // 27 - single-quoted literal `$foo`
    'echo {a,b)c}', // 28 - syntax error inside the brace, keep it last
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
    rmSync(dirname(MARKER), { recursive: true, force: true });
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

  /** the `|`item`|` rows of the expansion preview, in order */
  function expandedItems(value: string | null): string[] {
    return [...(value ?? '').matchAll(/\|`(.*)`\|/g)].map(m => m[1]!);
  }

  it.each([
    [0, 12, '`{`'],
    [0, 13, 'first item'],
    [0, 14, '`,`'],
    [0, 19, 'last item'],
  ])('single-line brace: hovering %i:%i (%s) previews every item', async (line, character) => {
    const value = await hoverValue(line, character);
    expect(value).toContain('BRACE EXPANSION');
    expect(expandedItems(value)).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    [1, 12, '`{`'],
    [1, 13, 'trailing `\\` line continuation'],
    [2, 0, 'first item on its own line'],
    [3, 0, 'middle item'],
    [4, 0, 'last item'],
    [4, 1, 'closing `}`'],
  ])('multiline brace: hovering %i:%i (%s) previews every item', async (line, character) => {
    const value = await hoverValue(line, character);
    expect(value).toContain('BRACE EXPANSION');
    expect(expandedItems(value)).toEqual(['a', 'b', 'c']);
  });

  it('multiline brace inside a concatenation previews the whole word', async () => {
    const value = await hoverValue(6, 0);
    expect(expandedItems(value)).toEqual(['prexpost', 'preypost']);
  });

  it('keeps quoting: `"foo bar"{1,2}` is two items, not three', async () => {
    const value = await hoverValue(8, 16);
    expect(expandedItems(value)).toEqual(['foo bar1', 'foo bar2']);
  });

  it('keeps escapes: `{a\\,b,c}` has an escaped comma', async () => {
    const value = await hoverValue(9, 6);
    expect(expandedItems(value)).toEqual(['a,b', 'c']);
  });

  it('caps the shown indentation of continuation lines at 4 spaces', async () => {
    const value = await hoverValue(15, 8);
    expect(value).toContain([
      '```txt',
      'z/{\\',
      '    1/a,\\', // 8 spaces
      '    2/b,\\', // 12 spaces
      '  3/c}', // under the cap: kept
      '```',
    ].join('\n'));
    expect(expandedItems(value)).toEqual(['z/1/a', 'z/2/b', 'z/3/c']);
  });

  /**
   * The preview is expanded by `fish -c`, so a command substitution in the word would
   * run on hover. It is expanded as the literal text of its source instead.
   */
  describe('command substitutions are literal, never run', () => {
    afterEach(() => {
      expect(existsSync(MARKER)).toBe(false);
    });

    it('`x(cmd){a,b}`', async () => {
      const value = await hoverValue(10, 15 + MARKER.length);
      expect(expandedItems(value)).toEqual([`x(touch ${MARKER})a`, `x(touch ${MARKER})b`]);
    });

    it('`"pre$(cmd)"{a,b}` inside double quotes', async () => {
      const value = await hoverValue(11, 20 + MARKER.length);
      expect(expandedItems(value)).toEqual([`pre$(touch ${MARKER})a`, `pre$(touch ${MARKER})b`]);
    });

    it('`{a,(cmd)}` as a brace item', async () => {
      const value = await hoverValue(12, 6);
      expect(expandedItems(value)).toEqual(['a', `(touch ${MARKER})`]);
    });

    it('keeps quotes inside the substitution: `{a,(echo "q\'x"),$(echo z)}`', async () => {
      const value = await hoverValue(13, 6);
      expect(expandedItems(value)).toEqual(['a', '(echo "q\'x")', '$(echo z)']);
    });

    it('`$PATH[(cmd)]{a,b}` in a variable index', async () => {
      const value = await hoverValue(19, 21 + MARKER.length);
      expect(expandedItems(value)).toEqual([`$PATH[(touch ${MARKER})]a`, `$PATH[(touch ${MARKER})]b`]);
    });
  });

  /**
   * Only brace syntax, plain variables, `~` and simple escapes are handed to fish
   * live; every other piece of the word is a quoted literal of its source.
   */
  describe('everything else is literal', () => {
    it('globs don\'t match files: `{fish_files/*.fish,fish_files/**,x}`', async () => {
      const value = await hoverValue(18, 38);
      expect(expandedItems(value)).toEqual(['fish_files/*.fish', 'fish_files/**', 'x']);
    });

    it('`"…"` keeps its escapes and plain variables', async () => {
      const value = await hoverValue(20, 22);
      expect(expandedItems(value)).toEqual([`q"$x\\y${process.env.HOME}a`, `q"$x\\y${process.env.HOME}b`]);
    });

    it('`\'…\'` keeps its escapes', async () => {
      const value = await hoverValue(21, 13);
      expect(expandedItems(value)).toEqual(['it\'sa', 'it\'sb']);
    });

    it('`--foo={a,b}` previews just the option value', async () => {
      const value = await hoverValue(22, 12);
      expect(expandedItems(value)).toEqual(['a', 'b']);
    });

    it('non-ASCII text keeps node offsets lined up: `"é$HOME"{1,2}`', async () => {
      const value = await hoverValue(23, 14);
      expect(expandedItems(value)).toEqual([`é${process.env.HOME}1`, `é${process.env.HOME}2`]);
    });

    // An already-escaped/quoted `$foo` is a literal, and fish expands all three the same
    // as `$foo/a $foo/b`. The unset-variable guard must not add a second escape or turn
    // the literal into an expansion.
    it.each([
      [25, 10, '`\\$foo/{a,b}` escaped'],
      [26, 12, '`"\\$foo"/{a,b}` escaped in double quotes'],
      [27, 12, "`'$foo'/{a,b}` single-quoted"],
    ])('a literal `$foo` stays literal (line %i)', async (line, character) => {
      const value = await hoverValue(line, character);
      expect(expandedItems(value)).toEqual(['$foo/a', '$foo/b']);
    });

    it.each([
      [15, 'the word after it'],
      [16, 'the second `z`'],
      [18, '`{`'],
      [19, 'a brace item'],
    ])('a variable the preview\'s fish lacks stays `$not_set_z` (hovering column %i: %s)', async (character) => {
      const value = await hoverValue(24, character);
      expect(value).toContain('BRACE EXPANSION');
      expect(expandedItems(value)).toEqual(['a', 'b', 'c', 'd'].map(item => `$not_set_z/z/${item}`));
    });

    it('a syntax error still previews, quoting what the error left behind', async () => {
      const value = await hoverValue(28, 6);
      expect(value).toContain('has a syntax error');
      expect(expandedItems(value)).toEqual(['a', 'b)c']);
    });
  });
});

describe('hover for a variable a `set` command names', () => {
  let handle: TestServerHandle;
  beforeAll(async () => {
    handle = await createTestServer();
  });
  afterAll(async () => {
    await handle.shutdown();
  });

  // `var[2]` is a `concatenation`, which would otherwise preview its expansion
  it.each([
    'set --query var[2] && echo has idx 2',
    'set --query var',
    'set -e var[2]',
    'set -S var[1..2]',
    'set --query var[$var]',
    'set var[2] x',
  ])('`%s` resolves `var` to its local definition', async (line) => {
    const content = ['set -l var (seq 1 10)', line].join('\n');
    const doc = createFakeLspDocument('/tmp/hover-set-target.fish', content);
    analyzer.analyze(doc);
    const hover = await handle.server.onHover({
      textDocument: { uri: doc.uri },
      position: { line: 1, character: line.indexOf('var') + 1 },
    } as LSP.HoverParams);
    const value = String((hover?.contents as LSP.MarkupContent | undefined)?.value ?? '');

    expect(value).toContain('(**variable**) `var`');
    expect(value).toContain('set -l var (seq 1 10)');
  });
});

describe('hover for a quoted piece of a word without a brace', () => {
  let handle: TestServerHandle;
  beforeAll(async () => {
    handle = await createTestServer();
  });
  afterAll(async () => {
    await handle.shutdown();
  });

  // only a word with a brace previews its expansion from a quoted piece
  it.each([
    ['alias fish_alias=\'fish\'', 'fish\''],
    ['alias fish_alias="fish"', 'fish"'],
    ['echo --opt=\'value\'', 'value'],
  ])('`%s` shows no expansion preview', async (line, text) => {
    const doc = createFakeLspDocument('/tmp/hover-quoted-piece.fish', line);
    analyzer.analyze(doc);
    const hover = await handle.server.onHover({
      textDocument: { uri: doc.uri },
      position: { line: 0, character: line.indexOf(text) + 1 },
    } as LSP.HoverParams);
    expect(JSON.stringify(hover?.contents ?? '')).not.toContain('```txt');
  });
});
