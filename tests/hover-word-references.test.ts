import { createTestServer, setLogger, TestServerHandle } from './helpers';
import TestWorkspace from './test-workspace-utils';
import FishServer from '../src/server';

setLogger();

function hoverText(hover: Awaited<ReturnType<FishServer['onHover']>>): string {
  if (!hover) return '';
  const contents = hover.contents as { value?: string; } | string;
  return typeof contents === 'string' ? contents : contents.value ?? '';
}

const STRING_DOCS = 'cmds/string.html';

// The DocumentationCache is keyed by name alone, so hovering a word that merely
// shares a command's name must only show that command's docs where the word
// sits in a command position (`src/parsing/word-references.ts`). Literal
// arguments fall back to the docs of the command they belong to.
describe('server onHover - command docs follow word-reference rules', () => {
  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  // `docs: null` — anything but `string`'s docs (the fallback is a system man page)
  const cases: Array<[source: string, docs: string | null]> = [
    // literal arguments: the parent command's docs, never `string`'s
    ['echo string', 'cmds/echo.html'],
    ['set x string', 'cmds/set.html'],
    // command positions: `string`'s docs
    ['string split', STRING_DOCS],
    ['command string split', STRING_DOCS],
    ['complete -c foo -w string', STRING_DOCS],
    ['sudo string split', STRING_DOCS],
    ['eval string split', STRING_DOCS],
    ['env FOO=1 string split', STRING_DOCS],
    ['sudo env FOO=1 string split', STRING_DOCS],
    ['sudo command echo string', null],
    ["alias ss 'string split'", STRING_DOCS],
  ];

  const workspace = TestWorkspace.create().addFiles(
    { relativePath: 'conf.d/hover-words.fish', content: cases.map(([source]) => source).join('\n') },
  ).initialize();

  it.each(cases.map(([source, docs], line) => [source, docs, line] as const))(
    '`%s` shows %s', async (source, docs, line) => {
      const doc = workspace.getDocument('conf.d/hover-words.fish')!;
      const hover = await server.onHover({
        textDocument: { uri: doc.uri },
        position: { line, character: source.indexOf('string') + 2 },
      });
      const text = hoverText(hover);
      if (docs) expect(text).toContain(docs);
      if (docs !== STRING_DOCS) expect(text).not.toContain(STRING_DOCS);
    },
  );
});

// A word a runner runs (`eval foo`, `sudo foo`) is a call of the function `foo`,
// so hovering it shows the definition in the same file.
describe('server onHover - runner arguments resolve local functions', () => {
  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  const lines = [
    'function local_foo --description "local foo docs"',
    '    echo foo',
    'end',
    'eval local_foo',
    'sudo local_foo',
    'time local_foo',
    'exec local_foo',
    'echo local_foo',
  ];

  const workspace = TestWorkspace.create().addFiles(
    { relativePath: 'conf.d/hover-runners.fish', content: lines.join('\n') },
  ).initialize();

  it.each([3, 4, 5, 6])('`%s` shows the local definition', async (line) => {
    const doc = workspace.getDocument('conf.d/hover-runners.fish')!;
    const hover = await server.onHover({
      textDocument: { uri: doc.uri },
      position: { line, character: lines[line]!.indexOf('local_foo') + 2 },
    });
    expect(hoverText(hover)).toContain('local foo docs');
  });

  it('`echo local_foo` does not show the definition', async () => {
    const doc = workspace.getDocument('conf.d/hover-runners.fish')!;
    const hover = await server.onHover({
      textDocument: { uri: doc.uri },
      position: { line: 7, character: lines[7]!.indexOf('local_foo') + 2 },
    });
    expect(hoverText(hover)).not.toContain('local foo docs');
  });
});
