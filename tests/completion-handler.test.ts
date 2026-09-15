import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CompletionItemKind, CompletionParams, TextEdit } from 'vscode-languageserver';
import { analyzer } from '../src/analyze';
import { CompletionLineParser, getEmbeddedCommandline, tokenizeCommandline } from '../src/utils/completion/context';
import { excludeCompletionDirsCommand, shellComplete } from '../src/utils/completion/shell';
import { createFakeLspDocument, createTestServer, TestServerHandle } from './helpers';

describe('completion handler', () => {
  let handle: TestServerHandle;

  beforeAll(async () => {
    handle = await createTestServer({
      params: {
        capabilities: {
          workspace: { workspaceFolders: true },
          textDocument: { completion: { completionItem: { snippetSupport: true } } },
        },
      } as any,
    });
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  async function complete(content: string, filePath = '/tmp/completion-handler.fish') {
    const doc = createFakeLspDocument(filePath, content);
    analyzer.analyze(doc);
    const lines = content.split('\n');
    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: lines.length - 1, character: lines.at(-1)!.length },
    };
    return handle.server.onCompletion(params);
  }

  describe('getEmbeddedCommandline()', () => {
    it.each([
      ["complete -c foo -n '", ''],
      ["complete -c foo -n 'not __fish_seen", 'not __fish_seen'],
      ['complete -c foo -a "(', '('],
      ["complete -c foo --condition 'test -n \"$(cmd", 'test -n "$(cmd'],
      ["    complete -c foo -n 'set -q", 'set -q'],
      ["alias foo='git ch", 'git ch'],
      ["    alias foo='", ''],
    ])('%s -> %j', (line, expected) => {
      expect(getEmbeddedCommandline(line)).toBe(expected);
    });

    it.each([
      "complete -c foo -x '",
      "complete -c foo -n 'closed' -",
      "echo -n '",
      'alias foo=bar',
    ])('%s -> null', (line) => {
      expect(getEmbeddedCommandline(line)).toBeNull();
    });
  });

  describe('tokenizeCommandline()', () => {
    it.each([
      ['', null, [], ''],
      ['ec', null, [], 'ec'],
      ['ls -', 'ls', [], '-'],
      ['function foo -e ', 'function', ['foo', '-e'], ''],
      ['function foo -e', 'function', ['foo'], '-e'],
      ['break ', 'break', [], ''],
      ['function foo; break ', 'break', [], ''],
      ['for x in (seq 3); continue ', 'continue', [], ''],
      ['if ', null, [], ''],
      ['if test -', 'test', [], '-'],
      ['else if ', null, [], ''],
      ['begin; not ', null, [], ''],
      ['FOO=bar ls -', 'ls', [], '-'],
      ['echo (', null, [], ''],
      ['echo (ls ', 'ls', [], ''],
      ['echo "$(ec', null, [], 'ec'],
      ['echo (ls) "a b" ', 'echo', ['(ls)', '"a b"'], ''],
      ['echo \\( ', 'echo', ['\\('], ''],
      ['echo 2>&1 ', 'echo', ['2>&1'], ''],
      ['echo foo && ', null, [], ''],
      ['echo foo | string ', 'string', [], ''],
      ["complete -c foo -x 'fo", 'complete', ['-c', 'foo', '-x'], 'fo'],
    ])('%j -> command: %j, args: %j, word: %j', (commandline, command, args, word) => {
      expect(tokenizeCommandline(commandline)).toEqual({ command, args, word });
    });
  });

  describe('CompletionLineParser.buildContext()', () => {
    let parser: CompletionLineParser;

    beforeAll(async () => {
      parser = await CompletionLineParser.create();
    });

    it.each([
      ['', 'empty', false],
      ['echo (', 'empty', false],
      ['and ', 'empty', false],
      ['if ', 'empty', false],
      ['else if ', 'empty', false],
      ['begin ', 'empty', false],
      ['ec', 'command', false],
      ['ls -', 'argument', false],
      ['echo ', 'argument', false],
      ['string sp', 'argument', false],
      ['function foo -e ', 'argument', false],
      ['switch ', 'argument', false],
      ['end ', 'blocked', false],
      ['break ', 'blocked', false],
      ['function foo; continue ', 'blocked', false],
      ['# ', 'comment', false],
      ['echo $P', 'variable', false],
      ['set -gx ', 'variable', false],
      ['    set -q ', 'variable', false],
      ['begin; set -l foo ', 'variable', false],
      ["complete -c foo -a '(", 'empty', true],
      ["complete -c foo -n 'not __f", 'command', true],
      ["alias foo='git ", 'argument', true],
    ])('%j -> %s (embedded: %s)', (line, mode, embedded) => {
      const doc = createFakeLspDocument('/tmp/completion-handler-context.fish', line);
      analyzer.analyze(doc);
      const position = { line: 0, character: line.length };
      const ctx = parser.buildContext({
        doc,
        position,
        symbols: [],
        documentWord: analyzer.parseCurrentLine(doc, position).word,
        current: analyzer.nodeAtPoint(doc.uri, 0, Math.max(line.length - 1, 0)),
      });
      expect(ctx.mode).toBe(mode);
      expect(ctx.embedded).toBe(embedded);
    });
  });

  it('completes commands at the cursor inside `complete -a "(`', async () => {
    const content = 'complete -c foo -a "(';
    const result = await complete(content);
    const item = result.items.find(i => i.label === 'commandline');

    expect(item).toBeDefined();
    expect(item!.kind).toBe(CompletionItemKind.Keyword);
    // inserted at the cursor, keeping the `"(` that was typed
    const textEdit = item!.textEdit as TextEdit;
    expect(textEdit.range.start.character).toBe(content.length);
    expect(textEdit.range.end.character).toBe(content.length);
  });

  describe('keywords that tree-sitter cannot parse on an unfinished line', () => {
    it('`function foo -e <TAB>` offers events, not the command list', async () => {
      const result = await complete('function foo -e ');
      const labels = result.items.map(i => i.label);
      const events = handle.server.completions.allOfKinds('event').map(i => i.label);

      expect(labels).toEqual(expect.arrayContaining(events));
      expect(labels).not.toContain('commandline');
    });

    it('`function foo -v <TAB>` offers variables', async () => {
      const result = await complete('function foo -v ');
      const labels = result.items.map(i => i.label);

      expect(labels).toContain('PATH');
      expect(labels).not.toContain('commandline');
    });

    it.each([
      'break ',
      'continue ',
      'function foo; break ',
    ])('%j only offers pipes', async (content) => {
      const result = await complete(content);
      const pipes = handle.server.completions.allOfKinds('pipe').map(i => i.label);

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.map(i => i.label).every(label => pipes.includes(label))).toBe(true);
    });

    it('`if <TAB>` offers commands', async () => {
      const result = await complete('if ');
      expect(result.items.map(i => i.label)).toContain('commandline');
    });

    it('`echo <TAB>` completes like any other command argument', async () => {
      const result = await complete('set -l myvar 1\necho ');
      const item = result.items.find(i => i.label === 'myvar');

      expect(item?.insertText).toBe('$myvar');
      expect(result.items.map(i => i.label)).not.toContain('PATH');
    });
  });

  describe('command positions list local functions, keywords and commands', () => {
    const prefix = 'function _completion_handler_local\n    echo hi\nend\n';

    it.each([
      "complete -c foo -a '(",
      'complete -c foo -a "(',
      "complete -c foo -n '",
      'echo (',
      '',
    ])('%j', async (line) => {
      const result = await complete(prefix + line);
      const labels = result.items.map(i => i.label);
      const indexOf = (label: string) => labels.indexOf(label);
      const command = handle.server.completions.allOfKinds('command')[0]!.label;

      expect(indexOf('_completion_handler_local')).toBeGreaterThanOrEqual(0);
      expect(indexOf('if')).toBeGreaterThanOrEqual(0);
      expect(indexOf(command)).toBeGreaterThanOrEqual(0);
      // clients cap long lists, so local functions and keywords must come first
      expect(indexOf('_completion_handler_local')).toBeLessThan(indexOf('if'));
      expect(indexOf('if')).toBeLessThan(indexOf(command));
    });

    it("`complete -c foo -a '(` has no global variables or pipe operators", async () => {
      const result = await complete(prefix + "complete -c foo -a '(");
      const labels = result.items.map(i => i.label);

      expect(labels).not.toContain('PATH');
      expect(labels).not.toContain('$PATH');
      expect(labels).not.toContain('|');
      expect(labels).not.toContain('&&');
    });

    it("`complete -c foo -a '(_completion_h` finds the local function", async () => {
      const result = await complete(prefix + "complete -c foo -a '(_completion_h");
      expect(result.items.map(i => i.label)).toContain('_completion_handler_local');
    });
  });

  it('does not mutate shared CompletionItemMap entries', async () => {
    await complete('__fish');
    await complete("complete -c foo -n '__fish");
    const mapItems = handle.server.completions.allOfKinds('function', 'builtin');
    expect(mapItems.length).toBeGreaterThan(0);
    expect(mapItems.filter(item => item.textEdit || item.data)).toEqual([]);
  });

  it('keeps overlapping requests separate', async () => {
    const [ls, set] = await Promise.all([
      complete('ls -', '/tmp/completion-handler-ls.fish'),
      complete('set -', '/tmp/completion-handler-set.fish'),
    ]);
    const lsLabels = ls.items.map(i => i.label);
    const setLabels = set.items.map(i => i.label);

    expect(lsLabels).toContain('--almost-all');
    expect(lsLabels).not.toContain('--erase');
    expect(setLabels).toContain('--erase');
    expect(setLabels).not.toContain('--almost-all');
  });

  it.each(['echo "$(echo $rev', 'echo $(echo $rev', 'echo "$(echo $$rev'])('preserves variable expansion inside %j', async (line) => {
    const result = await complete('set -l reviewvar value\n' + line);
    const edit = result.items.find(item => item.label === 'reviewvar')?.textEdit as TextEdit;
    expect(edit).toBeDefined();
    expect(line.slice(0, edit.range.start.character) + edit.newText).toBe(line + 'iewvar');
    expect(edit.range.end).toEqual({ line: 1, character: line.length });
  });

  describe('completions/<cmd>.fish being edited', () => {
    let root: string;
    let completionsDir: string;
    const originalCompletePath = process.env.fish_complete_path;
    const originalPath = process.env.PATH;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'fish-lsp-completions-'));
      completionsDir = join(root, 'completions');
      mkdirSync(completionsDir);
      writeFileSync(join(completionsDir, 'fishlspdemo.fish'), 'complete -c fishlspdemo -l from-disk\n');
      // fish only autoloads completions for a command it can find
      const binDir = join(root, 'bin');
      mkdirSync(binDir);
      writeFileSync(join(binDir, 'fishlspdemo'), '#!/bin/sh\n', { mode: 0o755 });
      process.env.PATH = `${binDir}:${originalPath}`;
      process.env.fish_complete_path = completionsDir;
    });

    afterAll(() => {
      if (originalCompletePath === undefined) {
        delete process.env.fish_complete_path;
      } else {
        process.env.fish_complete_path = originalCompletePath;
      }
      process.env.PATH = originalPath;
      rmSync(root, { recursive: true, force: true });
    });

    it('excludeCompletionDirsCommand() erases a directory literally', () => {
      expect(excludeCompletionDirsCommand(["/tmp/it's [a]*"])).toBe(
        "while set -l i (contains -i -- '/tmp/it\\'s [a]*' $fish_complete_path); set -e fish_complete_path[$i]; end; " +
        "while set -l i (contains -i -- '/tmp/it\\'s [a]*/' $fish_complete_path); set -e fish_complete_path[$i]; end",
      );
    });

    it('fish autoloads the file on disk unless its directory is excluded', async () => {
      const loaded = await shellComplete('fishlspdemo --');
      expect(loaded.map(([label]) => label)).toContain('--from-disk');

      const excluded = await shellComplete('fishlspdemo --', { excludeCompletionDirs: [completionsDir] });
      expect(excluded.map(([label]) => label)).not.toContain('--from-disk');
    });

    it('does not autoload the edited completions file, but still completes other commands', async () => {
      const filePath = join(completionsDir, 'fishlspdemo.fish');

      const demo = await complete('fishlspdemo --', filePath);
      expect(demo.items.map(i => i.label)).not.toContain('--from-disk');

      const other = await complete('set -', filePath);
      expect(other.items.map(i => i.label)).toContain('--erase');
    });

    it('autoloads the completions file from other documents', async () => {
      const result = await complete('fishlspdemo --', '/tmp/completion-handler-other.fish');
      expect(result.items.map(i => i.label)).toContain('--from-disk');
    });
  });
});
