import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { CompletionItemKind, CompletionParams, TextEdit } from 'vscode-languageserver';
import { analyzer } from '../src/analyze';
import { CompletionContext, CompletionLineParser, getEmbeddedCommandline, tokenizeCommandline } from '../src/completions/context';
import { wordPrefixItems } from '../src/completions/sources';
import { excludeCompletionDirsCommand, shellComplete } from '../src/completions/shell';
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

  // Prints what a client receives: drop `.skip`, then run with `-t "raw completion output"`
  describe.skip('raw completion output', () => {
    it.each(['string ', 'string s', 'path '])('%j', async (content) => {
      console.table((await complete(content)).items.map(({ sortText, kind, label, filterText, textEdit, insertText }) => ({
        sortText, kind: Object.entries(CompletionItemKind).find(([, value]) => value === kind)?.[0], label, filterText,
        range: textEdit && 'range' in textEdit ? `${textEdit.range.start.character}-${textEdit.range.end.character}` : '',
        inserts: (textEdit?.newText ?? insertText ?? '').replace(/\n/g, '⏎'),
      })));
    });
  });

  describe('getEmbeddedCommandline()', () => {
    it.each([
      ["complete -c foo -n '", ''],
      ["complete -c foo -n 'not __fish_seen", 'not __fish_seen'],
      ['complete -c foo -a "(', '('],
      ["complete -c foo -xa '(", '('],
      ["complete -c foo -xka '(ls", '(ls'],
      ['complete -c foo -fa "(', '('],
      ["complete -c foo -xn 'not __fish_seen", 'not __fish_seen'],
      ["complete -c foo -n '__fish_seen_subcommand_from bar && not __fish_contains_opt -s s long' -s s -l long -d 's/long' -xa '(", '('],
      ["complete -c foo -n 'test -a \"$x\"' -a '(ls", '(ls'],
      ["complete -c foo -d 'it\\'s -a' -a \"(", '('],
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
      ['echo >/tm', 'echo', [], '/tm'],
      ['echo 2>>/tm', 'echo', [], '/tm'],
      ['echo </tm', 'echo', [], '/tm'],
      ['echo &>/tm', 'echo', [], '/tm'],
      ['echo >?/tm', 'echo', [], '/tm'],
      ['echo \\>/tm', 'echo', [], '\\>/tm'],
      ['echo ">/tm', 'echo', [], '>/tm'],
      ['echo foo && ', null, [], ''],
      ['echo foo | string ', 'string', [], ''],
      ["complete -c foo -x 'fo", 'complete', ['-c', 'foo', '-x'], 'fo'],
      // an unescaped newline ends a statement, so earlier lines never leak in
      ['echo hi\nls -', 'ls', [], '-'],
      ['function foo\n    set -l x\n    echo ', 'echo', [], ''],
      // a string, a `(` or a `\` continuation carries the statement across lines
      ['echo "a\nb" ', 'echo', ['"a\nb"'], ''],
      ['echo "a\nb" arg ', 'echo', ['"a\nb"', 'arg'], ''],
      ['echo "oops\nfoo ', 'echo', [], 'oops\nfoo '],
      ["set -l x 'a\nb' ", 'set', ['-l', 'x', "'a\nb'"], ''],
      ['echo a \\\n    b ', 'echo', ['a', 'b'], ''],
      ['echo foo\\\nbar ', 'echo', ['foobar'], ''],
      ['echo (\n    ls ', 'ls', [], ''],
      ["# don't modify this\nstring sp", 'string', [], 'sp'],
      ['echo hi # " ( ) ; | & \\\nstring sp', 'string', [], 'sp'],
      ["echo (# don't close )\nstring sp", 'string', [], 'sp'],
      ['echo "$(# ignore ")\nstring sp', 'string', [], 'sp'],
      ["echo (# don't close )\ntrue) arg ", 'echo', ["(# don't close )\ntrue)", 'arg'], ''],
      ['echo # unfinished " (', 'echo', [], ''],
      ['echo foo#bar ', 'echo', ['foo#bar'], ''],
      ['echo "#quoted" ', 'echo', ['"#quoted"'], ''],
      ["echo '#quoted' ", 'echo', ["'#quoted'"], ''],
      ['echo \\#escaped ', 'echo', ['\\#escaped'], ''],
      ["echo ># don't quote\nstring sp", 'string', [], 'sp'],
    ])('%j -> command: %j, args: %j, word: %j', (commandline, command, args, word) => {
      expect(tokenizeCommandline(commandline)).toMatchObject({ command, args, word });
    });

    it.each([
      ['ls -', 0],
      ['echo hi\nls -', 8],
      ['foo; ls -', 4],
      ['echo "a\nb" ', 0],
      ['echo hi\necho (ls ', 8],
      ["# don't modify this\nstring sp", 20],
      ["echo (# don't close )\nstring sp", 0],
    ])('%j starts the cursor statement at %i', (commandline, start) => {
      expect(tokenizeCommandline(commandline).start).toBe(start);
    });
  });

  describe('CompletionLineParser.buildContext()', () => {
    let parser: CompletionLineParser;

    beforeAll(async () => {
      parser = await CompletionLineParser.create();
    });

    it('ignores quotes in preceding comments when determining the replacement length', () => {
      const doc = createFakeLspDocument('/tmp/completion-comment-context.fish', "# don't modify this\nstring sp");
      analyzer.analyze(doc);
      const position = { line: 1, character: 9 };
      const ctx = parser.buildContext({
        doc, position, symbols: [],
        documentWord: analyzer.parseCurrentLine(doc, position).word,
        current: analyzer.nodeAtPoint(doc.uri, 1, 8),
      });
      expect(ctx).toMatchObject({ command: 'string', word: 'sp', replaceLength: 2, mode: 'argument', commandline: 'string sp' });
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

  it('replaces only the current argument after a comment containing an unmatched quote', async () => {
    const result = await complete("# don't modify this\nstring sp");
    const edit = result.items.find(item => item.label === 'split')?.textEdit as TextEdit;
    expect(edit).toMatchObject({
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 9 } },
      newText: 'split',
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
      "complete -c foo -xa '(",
      "complete -c foo -xka '(",
      "complete -c foo -n '__fish_seen_subcommand_from bar && not __fish_contains_opt -s s long' -s s -l long -d 's/long' -xa '(",
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

  it.each(['$', '$HO', '$$HO'])('keeps a typed %j in front of a variable from the word prefix', async (word) => {
    const ctx = { mode: 'argument', word, isDefinitionSlot: false, variables: [], commandline: `echo ${word}` } as unknown as CompletionContext;
    const item = (await wordPrefixItems(ctx, handle.server.completions)).find(item => item.label === 'HOME');
    expect(item?.insertText).toBe(`${/^\$+/.exec(word)![0]}HOME`);
  });

  it('does not mutate shared CompletionItemMap entries', async () => {
    await complete('__fish');
    await complete("complete -c foo -n '__fish");
    const mapItems = handle.server.completions.allOfKinds('function', 'builtin');
    expect(mapItems.length).toBeGreaterThan(0);
    expect(mapItems.filter(item => item.textEdit || item.data)).toEqual([]);
  });

  it.each(['>', '2>', '>>', '2>>', '<', '&>', '>?'])('preserves %s when accepting a path completion', async (operator) => {
    const content = `echo ${operator}/tm`;
    const result = await complete(content);
    const edit = result.items.find(item => item.label === '/tmp/')?.textEdit as TextEdit;
    expect(edit).toBeDefined();
    expect(content.slice(0, edit.range.start.character) + edit.newText).toBe(`echo ${operator}/tmp/`);
    expect(edit.range.end.character).toBe(content.length);
  });

  describe('operators at command endings', () => {
    it.each(['fish-lsp ', 'fish-lsp\t', 'set -q PATH; fish-lsp '])('inserts valid combiners and omits negation after %j', async (content) => {
      const result = await complete(content);
      const labels = result.items.map(item => item.label);
      expect(labels).not.toContain('not');
      expect(labels).not.toContain('!');
      for (const label of ['and', 'or', '&&', '||']) {
        const item = result.items.find(item => item.label === label)!;
        expect(item).toBeDefined();
        const edit = item.textEdit as TextEdit | undefined;
        const inserted = edit
          ? content.slice(0, edit.range.start.character) + edit.newText + content.slice(edit.range.end.character)
          : content + (item.insertText ?? item.label);
        expect(inserted).toBe(content + (label === 'and' || label === 'or' ? `; ${label}` : label));
        expect(() => execFileSync('fish', ['--no-config', '--no-execute', '-c', inserted + ' echo true'], { stdio: 'pipe' })).not.toThrow();
      }
    });

    it.each(['', 'set -q PATH\n', 'set -q PATH;\n', 'set -q PATH; '])('keeps word combiners and negation at a new command position: %j', async (content) => {
      const result = await complete(content);
      const labels = result.items.map(item => item.label);
      expect(labels).not.toContain('&&');
      expect(labels).not.toContain('||');
      for (const label of ['and', 'or', 'not', '!']) {
        const item = result.items.find(item => item.label === label && item.kind !== CompletionItemKind.Snippet)!;
        expect(item).toBeDefined();
        expect(item.insertText ?? item.label).toBe(label);
      }
    });

    it.each([
      'foo ',
      'foo arg ',
      'foo\t',
      'string match -r pattern ',
      'echo "hello world" ',
      'echo {a,b} ',
      'foo >/tmp/output ',
      'foo 2>&1 ',
      'not foo ',
      'foo && bar ',
      'echo (foo ',
      'echo $foo ',
      '{ ;; } ',
      '{ ;; }',
      '{\n;;\n\n} ',
      'begin\n    echo hi\nend ',
      'if true\n    echo hi\nend ',
      'while true; end ',
      'for x in a b; end ',
      'switch $x; case a; end ',
      'function foo; end ',
      'function foo\n    echo hi ',
      'foo \\\n    bar ',
      'foo |\n    bar ',
      'echo "multi\nline" ',
      'echo a \\\n    b ',
    ])('offers pipes and redirects after %j', async (content) => {
      const result = await complete(content);
      expect(result.items.map(item => item.label)).toEqual(expect.arrayContaining(['|', '>', '>>', '<', '2>', '&|']));
      if (content.trimStart().startsWith('{') || content.endsWith('end ')) {
        const edit = result.items.find(item => item.label === '|')!.textEdit as TextEdit;
        expect(edit.range.start).toEqual(edit.range.end);
        expect(edit.range.end.character).toBe(content.split('\n').at(-1)!.length);
      }
    });

    it.each([
      '', 'foo | ', 'foo; ', 'foo > ', 'foo 2> ', 'foo arg > ',
      'echo "hello ', "echo 'hello ", 'echo escaped\\ ', 'echo "oops\nfoo ',
      'foo # comment ', 'function foo ', 'for x in ',
      // variable slots only take names
      'set ', 'set -q ', 'set -gx name ', 'set value 1 ',
    ])('does not offer operators in unfinished or non-command slots: %j', async (content) => {
      const result = await complete(content);
      const operatorItems = result.items.filter(item => (item as { fishKind?: string; }).fishKind === 'pipe');
      expect(operatorItems).toEqual([]);
    });
  });

  describe('filesystem matches are gated on the typed word', () => {
    const pathItems = (result: { items: { label: string; }[]; }) =>
      result.items.filter(item => (item as { fishKind?: string; }).fishKind === 'path').map(item => item.label);

    it.each(['foo ', 'ls ', 'cat ', 'echo ', 'foo arg '])('offers no files or folders at an empty word: %j', async (content) => {
      const result = await complete(content);
      expect(pathItems(result)).toEqual([]);
    });

    it.each([
      ['foo /tm', '/tmp/'],
      ['cat CO', 'CODE_OF_CONDUCT.md'],
      ['cat src/comp', 'src/completions/'],
    ])('%j offers %j once the word narrows it', async (content, label) => {
      const result = await complete(content);
      expect(pathItems(result)).toContain(label);
    });

    it('asks the client to re-request, so a dropped path returns as the word grows', async () => {
      expect((await complete('foo ')).isIncomplete).toBe(true);
    });

    it('offers only paths the word is a prefix of', async () => {
      const result = await complete('cat src/comp');
      expect(pathItems(result).every(label => label.startsWith('src/comp'))).toBe(true);
    });

    it('keeps a described match that a command listed itself', async () => {
      // `git add` tags its files (`README.md  Modified file`), so they are the
      // command's own arguments rather than fish falling back to the directory
      const result = await complete('git add ');
      const described = result.items.filter(item => /file/i.test(item.detail ?? ''));

      expect(described.length).toBeGreaterThan(0);
      expect(pathItems(result)).toEqual([]);
    });
  });

  it('keeps the directory marker and folder kind on shell argument completions', async () => {
    const result = await complete('foo /tm');
    const item = result.items.find(item => item.label === '/tmp/');
    expect(item?.kind).toBe(CompletionItemKind.Folder);
    expect((item?.textEdit as TextEdit)?.newText).toBe('/tmp/');
    expect(result.items.some(item => item.label === '/tmp')).toBe(false);
  });

  it.each(['string ', 'path ', 'status ', 'set -l var value; string '])('orders %j: the subcommands, then snippets, variables and pipes', async (content) => {
    const command = content.trim().split(/[\s;]+/).at(-1)!;
    const subcommands = execFileSync('fish', ['--no-config', '-c', `complete --do-complete '${command} '`], { encoding: 'utf8' })
      .trim().split('\n').map(line => line.split('\t')[0]!);
    const items = (await complete(content)).items;
    expect(items.slice(0, subcommands.length).map(item => item.label).sort()).toEqual([...subcommands].sort());
    // each type in one block, in this order
    const typeOf: Record<number, string> = {
      [CompletionItemKind.Property]: 'property', [CompletionItemKind.Snippet]: 'snippet', [CompletionItemKind.Variable]: 'variable',
      [CompletionItemKind.Operator]: 'pipe', [CompletionItemKind.Keyword]: 'pipe',
    };
    const types = items.map(item => typeOf[item.kind!]).filter(Boolean);
    const blocks = types.filter((type, i) => type !== types[i - 1]);
    expect(blocks).toEqual(['property', 'snippet', 'variable', 'pipe'].filter(type => blocks.includes(type)));
    // clients keep this order through sortText, but score an item by the text in its range first,
    // so nothing may replace the typed command name
    expect([...items].sort((x, y) => x.sortText!.localeCompare(y.sortText!))).toEqual(items);
    expect(items.filter(item => ((item.textEdit as TextEdit | undefined)?.range.start.character ?? content.length) < content.length)).toEqual([]);
  });

  it('a snippet matched by an exact trigger still comes first where no argument competes', async () => {
    expect((await complete('ife')).items[0]?.label).toBe('if-else');
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

  it('re-requests flags when an empty argument initially has none', async () => {
    const initial = await complete('string split ');
    expect(initial.items.some(item => item.label.startsWith('--'))).toBe(false);
    expect(initial.isIncomplete).toBe(true);
    const flags = await complete('string split -');
    expect(flags.items.map(item => item.label)).toContain('--right');
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
      writeFileSync(join(binDir, 'fishlspdemo'), '#!/bin/sh\n', { mode: 0o700 });
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

    it.each(['--', ''])('does not autoload the edited completions file at %j, but still completes other commands', async (word) => {
      const filePath = join(completionsDir, 'fishlspdemo.fish');

      const demo = await complete(`fishlspdemo ${word}`, filePath);
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
