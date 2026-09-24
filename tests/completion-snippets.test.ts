import { CompletionItem, CompletionItemKind, CompletionParams, InsertTextFormat, InsertTextMode, TextEdit } from 'vscode-languageserver';
import { analyzer } from '../src/analyze';
import { createFakeLspDocument, createTestServer, TestServerHandle } from './helpers';
import CompletionSnippets from '../src/snippets/completionSnippets.json';
import { StaticItems } from '../src/completions/static-items';
import { execFileSync } from 'child_process';
import { FishCompletionItem, FishCompletionItemKind, snippetToPlainText } from '../src/completions/types';
import FishServer, { cachedCompletionMap } from '../src/server';
import { config } from '../src/config';

type RawSnippet = {
  name: string;
  altTrigger?: string | string[];
  description: string;
  body: string | string[];
};

function expectedTriggers(item: RawSnippet): string[] {
  const alt = item.altTrigger === undefined ? [] : Array.isArray(item.altTrigger) ? item.altTrigger : [item.altTrigger];
  return Array.from(new Set([item.name, ...alt]));
}

function expectedBody(item: RawSnippet): string {
  return Array.isArray(item.body) ? item.body.join('\n') : item.body;
}

describe('completion snippets (src/snippets/completionSnippets.json)', () => {
  const snippets = CompletionSnippets as RawSnippet[];
  const snippetItems = StaticItems[FishCompletionItemKind.SNIPPET] as FishCompletionItem[];

  it('has at least one entry, each with a name/description/body', () => {
    expect(snippets.length).toBeGreaterThan(0);
    for (const item of snippets) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(expectedBody(item).length).toBeGreaterThan(0);
    }
  });

  it('produces exactly one CompletionItem per unique (name, trigger) pair', () => {
    const expectedCount = snippets.reduce((sum, item) => sum + expectedTriggers(item).length, 0);
    expect(snippetItems.length).toBe(expectedCount);
  });

  it('never produces an item with an undefined label or filterText', () => {
    // Regression test: static-items.ts used to read a `prefix` field that no
    // longer existed on most JSON entries, silently unioning in `undefined`
    // as an extra trigger for every snippet lacking it.
    for (const item of snippetItems) {
      expect(item.label).toBeDefined();
      expect(item.filterText).toBeDefined();
    }
  });

  it('builds one CompletionItem per declared trigger (name + altTrigger)', () => {
    for (const raw of snippets) {
      const body = expectedBody(raw);
      for (const trigger of expectedTriggers(raw)) {
        const item = snippetItems.find(i => i.label === raw.name && i.filterText === trigger);
        expect(item, `missing item for name=${raw.name} trigger=${trigger}`).toBeDefined();
        expect(item!.insertText).toBe(body);
        expect(item!.fishKind).toBe(FishCompletionItemKind.SNIPPET);
        expect(item!.kind).toBe(CompletionItemKind.Snippet);
        expect(item!.insertTextFormat).toBe(InsertTextFormat.Snippet);
        expect(item!.insertTextMode).toBe(InsertTextMode.adjustIndentation);
        // preselect is decided per request (exact trigger match), never on the shared item
        expect(item!.preselect).toBeUndefined();
      }
    }
  });

  it('has no duplicate (label, filterText) pairs', () => {
    const seen = new Set<string>();
    for (const item of snippetItems) {
      const key = `${item.label}\0${item.filterText}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  describe('snippet bodies write fish `$` correctly', () => {
    // Snippet syntax owns `$`: `$1` repeats tabstop 1's text and `$name` is a snippet
    // variable (unknown ones insert just `name`). A fish `$` must be written `\$`.
    const bodies = snippets.map(raw => [raw.name, expectedBody(raw)]);

    it.each(bodies)('%s: every `$` is escaped or starts a tabstop', (_name, body) => {
      // `$` followed by something other than `1`, `{1`, `{name`
      const unescaped = [...body.matchAll(/(?<!\\)\$(?!\d|\{)/g)].map(m => body.slice(m.index, m.index + 8));
      expect(unescaped).toEqual([]);
    });

    it.each(bodies)('%s: a mirrored variable name is expanded with `\\$`', (_name, body) => {
      // `set ${1:i} (math \$$1 + 1)` -> `set i (math $i + 1)`; a bare `$1` would insert `i`,
      // which only belongs where a name goes: `set $1 (math \$$1 + 1)`
      // a flag is literal (`-l`) or a choice placeholder (`${2|-l,-g|}`)
      const flag = String.raw`(?:\s+(?:-\S+|\$\{\d+\|[^}]*\|\}))*`;
      const namePosition = String.raw`(?<!\b(?:set${flag}|for|read${flag})\s+)`;
      const nameTabstops = [...body.matchAll(new RegExp(String.raw`\b(?:set${flag}|for|read${flag})\s+\$\{(\d+):`, 'g'))].map(m => m[1]!);
      const bareMirrors = nameTabstops.flatMap(n => [...body.matchAll(new RegExp(`${namePosition}(?<!\\\\\\$)\\$${n}(?!\\d)`, 'g'))].map(m => m[0]));
      expect(bareMirrors).toEqual([]);
    });

    it.each(bodies)('%s: the default expansion is valid fish', (_name, body) => {
      const plain = snippetToPlainText(body);
      expect(plain).not.toMatch(/\$\{\d/);
      // a body starting with `(` is only offered as an argument, see isArgumentSnippet()
      const inserted = plain.startsWith('(') ? `echo ${plain}` : plain;
      expect(() => execFileSync('fish', ['--no-execute', '-c', inserted], { stdio: 'pipe' })).not.toThrow();
    });
  });

  describe('what a snippet inserts runs as intended', () => {
    const plainBody = (name: string) => snippetToPlainText(expectedBody(snippets.find(raw => raw.name === name)!));
    const fish = (script: string, input?: string) => execFileSync('fish', ['--no-config', '-c', script], { encoding: 'utf8', input });
    const yes: [string, string] = ['command ...', 'echo yes'];

    // [snippet, [default text, filled-in text] in order, script around the inserted text `%`, output, stdin]
    it.each<[string, [string, string][], string, string, string?]>([
      ['string-replace', [['pattern', 'old'], ['replacement', 'new'], ['argument ...', 'old-value']], '%', 'new-value\n'],
      ['function-described', [['explanation', 'two words'], ['command ...', 'echo ran']], '%\nname', 'ran\n'],
      ['function-described-with-arguments', [['explanation', 'two words'], ['argument ...', 'arg'], ['command ...', 'echo ran']], '%\nname', 'ran\n'],
      ['argparse-help', [], 'function demo\n%\necho continued\nend\ndemo -h; echo status=$status', 'Usage: my_function [-h | --help]\nstatus=0\n'],
      ['argparse-help', [], 'function demo\n%\necho continued\nend\ndemo --help; echo status=$status', 'Usage: my_function [-h | --help]\nstatus=0\n'],
      ['skip-first', [['count', '1']], '%', 'b\nc\n', 'a\nb\nc\n'],
      ['skip-first', [['count', '3']], '%', '', 'a\nb\nc\n'],
      ['skip-first', [['-n', '-c'], ['count', '1']], '%', 'bc', 'abc'],
      ['for-enumerate', [['command ...', 'echo $i $item']], 'set -l list a b c\n%', '1 a\n2 b\n3 c\n'],
      ['for-argv', [['command ', 'echo ']], 'function f\n%\nend\nf a b', 'a\nb\n'],
      ['math', [['expression', '10 * (1 + 3) / 16']], '%', '2.5\n'],
      ['math-scale', [['expression', '10 / 3']], '%', '3.33\n'],
      // -s 0 -m floor: -3.5 rounds down, where the default truncate gives -3
      ['math-scale-mode', [['expression', '-7 / 2']], '%', '-4\n'],
      ['math-base', [['expression', '255']], '%', '0xff\n'],
      ['math-function', [['(x)', '(-3)']], '%', '3\n'],
      ['set-math', [['expression', '6 * 7']], '%; echo $variable', '42\n'],
      ['random', [['1 10', '5 5']], '%', '5\n'],
      ['random-choice', [], 'set -l list a\n%', 'a\n'],
      ['if-file-exists', [['path', '/fish-lsp-no-such-path'], yes], '%', ''],
      ['if-directory', [['path', '/etc/passwd'], yes], '%', ''],
      ['if-file', [['path', '/'], yes], '%', ''],
      ['if-executable', [['path', '/etc/passwd'], yes], '%', ''],
      ['if-string-regex-match', [['regex', '^a.c$'], yes], 'set -l variable abc\n%', 'yes\n'],
      ['if-string-regex-match', [['regex', '^a.c$'], yes], 'set -l variable abd\n%', ''],
      ['if-set', [['(command)', '(echo found)'], ['\t\n', '\techo $var\n']], '%', 'found\n'],
      ['if-set', [['(command)', '(false)'], ['\t\n', '\techo $var\n']], '%', ''],
      ['if-no-arguments', [], 'function f\n%\necho ran\nend\nf 2>&1; echo status $status; f x', 'usage: name argument ...\nstatus 1\nran\n'],
      ['string-split', [['-- string', '-- a,b']], '%', 'a\nb\n'],
      ['string-join', [], 'set -l list a b\n%', 'a,b\n'],
      ['string-trim', [['-- string', "-- '  x  '"]], '%', 'x\n'],
      ['string-trim-chars', [['-- string', '-- /x/']], '%', 'x\n'],
      ['string-match-groups', [['-- \'(\\w+)\' string', "-- '(\\w+)' key=val"]], '%', 'key\n'],
      ['error-return', [], 'function f\n%\nend\nf 2>&1; echo $status', 'error\n1\n'],
      ['printf', [], 'function f\n%\nend\nf a b', 'a\nb\n'],
      ...['abbr', 'abbr-anywhere', 'abbr-cursor', 'abbr-function'].map((name): [string, [string, string][], string, string] =>
        [name, [], '%\nabbr --query name; and echo defined', 'defined\n']),
      ['abbr-command', [], '%\nabbr --query co; and echo defined', 'defined\n'],
    ])('%s (%#)', (name, fills, script, expected, input) => {
      const inserted = fills.reduce((text, [from, to]) => text.replace(from, () => to), plainBody(name));
      expect(fish(script.replace('%', () => inserted), input)).toBe(expected);
    });

    it('complete-subcommands describes each subcommand, until one is given', () => {
      const complete = plainBody('complete-subcommands').replace('-c command ', '-c fishlspdemo ');
      const [before, after] = fish(`function fishlspdemo; end\n${complete}\ncomplete --do-complete='fishlspdemo '; echo SPLIT; complete --do-complete='fishlspdemo subcommand '`).split('SPLIT\n');
      expect(before).toBe('subcommand\tdescription\n');
      expect(after).not.toContain('subcommand\t');
    });
  });

  describe('snippetToPlainText()', () => {
    it.each([
      ['set ${1:i} (math \\$$1 + ${2:1})$0', 'set i (math $i + 1)'],
      ['set ${1|-q,--query|} ${2:variable}', 'set -q variable'],
      ['${1:first}${2|; or, \\|\\||} ${3:second}', 'first; or second'],
      ['while read -l ${1:line}\n\t${2:command \\$$1}\nend$0', 'while read -l line\n\tcommand $line\nend'],
      ['for ${1:item} in \\$(seq ${2:from} ${3:to})', 'for item in $(seq from to)'],
      ['${1:outer ${2:inner}} $2', 'outer inner inner'],
      ['\\x${1:xx}', '\\xxx'],
      ['[${1:start}-${2:end}]', '[start-end]'],
      ['\\$${1:n}', '$n'],
      ['echo $TM_FILENAME', 'echo TM_FILENAME'],
      ['echo ${1:foo}\\', 'echo foo\\'],
    ])('%j -> %j', (snippet, expected) => {
      expect(snippetToPlainText(snippet)).toBe(expected);
    });
  });

  it('every altTrigger-bearing snippet is also reachable by its own name', () => {
    for (const raw of snippets) {
      const canonical = snippetItems.find(i => i.label === raw.name && i.filterText === raw.name);
      expect(canonical, `missing canonical (name-triggered) item for ${raw.name}`).toBeDefined();
    }
  });
});

describe('completion snippets selection (via server.onCompletion)', () => {
  let handle: TestServerHandle;
  let server: FishServer;
  const multiwordSnippets = config.fish_lsp_enable_multiword_snippets;

  async function completeAt(content: string, filePath = '/tmp/completion-snippet-selection.fish') {
    const doc = createFakeLspDocument(filePath, content);
    analyzer.analyze(doc);
    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };
    return server.onCompletion(params);
  }

  beforeAll(async () => {
    handle = await createTestServer({
      params: {
        capabilities: {
          textDocument: {
            completion: {
              completionItem: {
                snippetSupport: true,
              },
            },
          },
        },
      } as any,
    });
    server = handle.server;
    config.fish_lsp_enable_multiword_snippets = true;
  });

  afterAll(async () => {
    config.fish_lsp_enable_multiword_snippets = multiwordSnippets;
    await handle?.shutdown();
  });

  it('exposes the "if-else" snippet under its short altTrigger "ife"', async () => {
    const result = await completeAt('ife');
    const items = result.items.filter(i =>
      (i as FishCompletionItem).fishKind === FishCompletionItemKind.SNIPPET
      && i.label === 'if-else',
    ) as FishCompletionItem[];

    const trigger = items.find(i => i.filterText === 'ife');
    expect(trigger).toBeDefined();
    expect(trigger?.insertText).toBe([
      'if ${1:condition}',
      '\t${2:command ...}',
      'else',
      '\t${3:command ...}$0',
      'end',
    ].join('\n'));

    // the exact trigger match should be ranked ahead of the other "if-else" trigger variants
    const snippetLabelIndex = result.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => (item as FishCompletionItem).fishKind === FishCompletionItemKind.SNIPPET && item.label === 'if-else');
    const firstRanked = snippetLabelIndex[0]!.item as FishCompletionItem;
    expect(firstRanked.filterText).toBe('ife');
  });

  it('exposes the "_flag" snippet under both its name and short altTrigger "_f"', async () => {
    const result = await completeAt('_f');
    const byName = result.items.find(i =>
      (i as FishCompletionItem).fishKind === FishCompletionItemKind.SNIPPET
      && i.label === '_flag'
      && i.filterText === '_f',
    ) as FishCompletionItem | undefined;
    expect(byName).toBeDefined();
    expect(byName?.insertText).toBe('_flag_${1:flag}');
  });

  it('finds the canonical (name-triggered) snippet items through cachedCompletionMap', () => {
    const item = cachedCompletionMap.findLabel('and', 'snippet');
    expect(item).toBeDefined();
    expect((item as FishCompletionItem).filterText).toBe('and');
    expect(item?.insertText).toBe('${1:first-expression}${2|; and, &&|} ${3:second-expression}');
  });

  it.each([
    ['', 'string replace', 'string replace'],
    ['', 'string rep', 'string replace'],
    ['', 'set color', 'set color'],
    ['', 'set ', 'set color'],
    ['', 'set i -', 'set i -'],
    ['', 'if else', 'if else'],
    ['    ', 'set color', 'set color'],
    ['echo hi; ', 'set color', 'set color'],
    ['echo hi | ', 'string rep', 'string replace'],
    ['not ', 'set color', 'set color'],
    ['echo "$(', 'set color', 'set color'],
    ["complete -c demo -n '", 'if else', 'if else'],
  ])('replaces the full multiword trigger in %j + %j', async (prefix, typed, trigger) => {
    const result = await completeAt(prefix + typed);
    const item = result.items.find(i => i.kind === CompletionItemKind.Snippet && i.filterText === trigger);
    expect(item).toBeDefined();
    const edit = item!.textEdit as TextEdit;
    expect(edit.range.start.character).toBe(prefix.length);
    expect(edit.range.end.character).toBe(prefix.length + typed.length);
    expect((prefix + typed).slice(0, edit.range.start.character) + edit.newText).toBe(prefix + item!.insertText);
    expect(!!item!.preselect).toBe(typed === trigger);
  });

  it.each(['echo set color', 'echo "set color', 'echo string replace'])('does not treat arguments as multiword snippet triggers: %j', async (content) => {
    const result = await completeAt(content);
    // only snippets inserted as an argument, like `(command | psub)`, belong here
    expect(result.items.filter(i => i.kind === CompletionItemKind.Snippet && !i.insertText?.startsWith('('))).toEqual([]);
  });

  describe('with fish_lsp_enable_multiword_snippets off (the default)', () => {
    beforeAll(() => {
      config.fish_lsp_enable_multiword_snippets = false;
    });
    afterAll(() => {
      config.fish_lsp_enable_multiword_snippets = true;
    });

    it.each(['string ', 'string s', 'set color', 'math sc', 'if e'])('matches no multiword trigger in %j', async (content) => {
      const snippets = (await completeAt(content)).items.filter(i => i.kind === CompletionItemKind.Snippet);
      // nothing matched through a phrase, so nothing replaces text before the typed word
      const wordStart = content.length - (content.split(/\s/).at(-1) ?? '').length;
      expect(snippets.filter(i => i.filterText?.includes(' ') || ((i.textEdit as TextEdit | undefined)?.range.start.character ?? wordStart) < wordStart)).toEqual([]);
    });

    it.each([['ife', 'if-else'], ['strsp', 'string-split'], ['set-color', 'set-color']])('still matches the one-word trigger %j', async (content, label) => {
      expect((await completeAt(content)).items.filter(i => i.kind === CompletionItemKind.Snippet).map(i => i.label)).toContain(label);
    });
  });

  it('does not disturb trailing document characters selecting "set-color" inside a nested command substitution', async () => {
    // echo "$(set-color<CURSOR>)"  -- the cursor sits before the closing `)"`,
    // which must survive untouched by the snippet's TextEdit.
    const before = 'echo "$(set-color';
    const after = ')"';
    const content = before + after;

    const doc = createFakeLspDocument('/tmp/set-color-inside-subshell.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: before.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i =>
      i.label === 'set-color' && (i as FishCompletionItem).fishKind === FishCompletionItemKind.SNIPPET,
    ) as FishCompletionItem | undefined;
    expect(item).toBeDefined();

    const textEdit = item!.textEdit as { newText: string; range: { start: { character: number; }; end: { character: number; }; }; };
    expect(textEdit).toBeDefined();

    // the edit must stop exactly at the cursor -- it can never reach into (or past) the trailing `)"`
    expect(textEdit.range.end.character).toBe(before.length);

    // simulate applying the edit against the real line buffer
    const editedBefore = content.slice(0, textEdit.range.start.character);
    const editedAfter = content.slice(textEdit.range.end.character);
    expect(editedAfter).toBe(after);

    const edited = editedBefore + textEdit.newText + editedAfter;
    expect(edited.endsWith(after)).toBe(true);
    expect(edited).toBe(
      'echo "$(set_color ${1|normal,black,red,green,yellow,blue,magenta,cyan,white,brblack,brred,brgreen,bryellow,brblue,brmagenta,brcyan,brwhite|})"',
    );
  });

  it('still attaches a textEdit while background analysis has not finished (regression)', async () => {
    // Root cause of the "set-color"/"recolor" trailing-`)"`-eaten bug: it had
    // nothing to do with nested `$(...)` or snippet body content -- before
    // this fix, `onCompletion()` bailed out to `completion.completeEmpty([])`
    // whenever `backgroundAnalysisComplete` was still false, which never
    // calls `.addData()` and so never attaches a `textEdit` to *any*
    // completion item, leaving clients to guess how much text to replace.
    const before = 'echo "$(recolor';
    const after = ')"';
    const content = before + after;

    const doc = createFakeLspDocument('/tmp/recolor-before-background-analysis.fish', content);
    analyzer.analyze(doc);

    const originalFlag = server.backgroundAnalysisComplete;
    server.backgroundAnalysisComplete = false;
    let result;
    try {
      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: before.length },
      };
      result = await server.onCompletion(params);
    } finally {
      server.backgroundAnalysisComplete = originalFlag;
    }

    const item = result.items.find(i =>
      i.label === 'reset-color' && (i as FishCompletionItem).filterText === 'recolor',
    ) as FishCompletionItem | undefined;
    expect(item).toBeDefined();
    expect(item!.insertText).toBe('set_color normal');

    const textEdit = item!.textEdit as { newText: string; range: { start: { character: number; }; end: { character: number; }; }; };
    expect(textEdit).toBeDefined();
    expect(textEdit.range.end.character).toBe(before.length);

    const editedAfter = content.slice(textEdit.range.end.character);
    expect(editedAfter).toBe(after);
  });

  describe('where snippets are offered', () => {
    const isSnippet = (item: CompletionItem) => (item as FishCompletionItem).fishKind === FishCompletionItemKind.SNIPPET;

    it('keeps the `if` builtin next to the `if` snippet', async () => {
      const result = await completeAt('if');
      const ifItems = result.items.filter(i => i.label === 'if');

      expect(ifItems.find(i => i.kind === CompletionItemKind.Keyword)).toBeDefined();
      expect(ifItems.find(i => i.kind === CompletionItemKind.Snippet)).toBeDefined();
    });

    it.each([
      '',
      'echo (',
      "complete -c foo -a '(",
      'not ',
    ])('offers snippets at the command position %j', async (content) => {
      const result = await completeAt(content);
      expect(result.items.some(isSnippet)).toBe(true);
    });

    it.each([
      'string match -',
      'end ',
      '# ',
      'echo $',
    ])('does not offer snippets in %j', async (content) => {
      const result = await completeAt(content);
      expect(result.items.some(isSnippet)).toBe(false);
    });

    describe('snippets inserted as an argument (a body starting with `(`)', () => {
      const isArgumentSnippet = (item: CompletionItem) => isSnippet(item) && !!item.insertText?.startsWith('(');

      it.each(['diff psu', 'diff proc', 'diff (sort a | psub) ps'])('offers only them once the argument names them: %j', async (content) => {
        const snippets = (await completeAt(content)).items.filter(isSnippet);
        expect(snippets.map(i => i.label)).toContain('process-substitution');
        expect(snippets.every(isArgumentSnippet)).toBe(true);
      });

      it.each(['ls ', 'cat ', 'diff (sort a | psub) ', 'diff p', "argparse 'h/help=!_validate_int --min 0 "])('does not list them at an argument that does not name them: %j', async (content) => {
        const snippets = (await completeAt(content)).items.filter(isSnippet);
        expect(snippets.some(isArgumentSnippet)).toBe(false);
      });

      it.each(['diff (', 'cat a (', 'echo ('])('finishes the `(` just typed in an argument: %j', async (content) => {
        const item = (await completeAt(content)).items.find(i => i.label === 'process-substitution');
        expect(item).toBeDefined();
        // the typed `(` stays, so the body drops its own
        expect(item!.insertText).toBe('${1:command} | psub)$0');
      });

      it.each(['', 'psu', 'echo hi; ', 'not ', '('])('never offers them at the command position %j', async (content) => {
        const snippets = (await completeAt(content)).items.filter(isSnippet);
        expect(snippets.length).toBeGreaterThan(0);
        expect(snippets.some(isArgumentSnippet)).toBe(false);
      });
    });

    it("replaces only the typed trigger inside `complete -c foo -a '(ife`", async () => {
      const content = "complete -c foo -a '(ife";
      const result = await completeAt(content);
      const item = result.items.find(i => isSnippet(i) && i.filterText === 'ife');
      const textEdit = item?.textEdit as TextEdit | undefined;

      expect(textEdit?.range.start.character).toBe(content.length - 'ife'.length);
      expect(textEdit?.range.end.character).toBe(content.length);
    });

    it.each(['', 'i', 'if', 'ife', 's', 'set', 'set i', 'w', 'str', 'echo (', 'not '])('lists each snippet once for %j', async (content) => {
      const labels = (await completeAt(content)).items.filter(isSnippet).map(i => i.label);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels).toEqual([...new Set(labels)]);
    });

    it.each([
      ['', 'if-else'], // no word: the name
      ['if', 'if-else'], // the name and `ife` both extend it: the name
      ['if-e', 'if-else'],
      ['ife', 'ife'], // only the altTrigger matches
      ['if e', 'if else'], // a multiword trigger, through its own range
    ])('%j keeps the if-else snippet under %j', async (content, trigger) => {
      const items = (await completeAt(content)).items.filter(i => isSnippet(i) && i.label === 'if-else');
      expect(items.map(i => i.filterText)).toEqual([trigger]);
    });

    it('asks again while a dropped trigger still extends the typed word', async () => {
      expect((await completeAt('')).isIncomplete).toBe(true);
      // `i` keeps `if`, whose filterText can never become `iff`
      expect((await completeAt('i')).isIncomplete).toBe(true);
      const iff = await completeAt('iff');
      expect(iff.items.filter(i => isSnippet(i) && i.label === 'if').map(i => i.filterText)).toEqual(['iff']);
      expect(iff.isIncomplete).toBe(false);
    });

    it('preselects only the snippet whose trigger is exactly the typed word', async () => {
      const result = await completeAt('ife');
      const preselected = result.items.filter(i => i.preselect);

      expect(preselected.map(i => [i.label, i.filterText])).toEqual([['if-else', 'ife']]);
    });

    it.each(['', 'if-e', 'set '])('preselects nothing for %j', async (content) => {
      const result = await completeAt(content);
      expect(result.items.filter(i => i.preselect)).toEqual([]);
    });

    it('resolves a snippet to its description, not the builtin of the same name', async () => {
      const result = await completeAt('if');
      const item = result.items.find(i => isSnippet(i) && i.label === 'if' && i.filterText === 'if')!;
      const resolved = await server.onCompletionResolve(item);
      const raw = (CompletionSnippets as RawSnippet[]).find(s => s.name === 'if')!;

      expect(JSON.stringify(resolved.documentation)).toContain(raw.description);
    });
  });
});

describe.each([
  { snippetSupport: false, enableSnippets: true },
  { snippetSupport: true, enableSnippets: false },
  { snippetSupport: false, enableSnippets: false },
])('plain completions with $snippetSupport client support and $enableSnippets configuration', ({ snippetSupport, enableSnippets }) => {
  let handle: TestServerHandle;
  let originalEnableSnippets: boolean;

  async function completeAt(content: string) {
    const doc = createFakeLspDocument('/tmp/completion-snippet-plain-client.fish', content);
    analyzer.analyze(doc);
    return handle.server.onCompletion({
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    });
  }

  beforeAll(async () => {
    originalEnableSnippets = config.fish_lsp_enable_snippets;
    handle = await createTestServer({ params: {
      capabilities: { textDocument: { completion: { completionItem: { snippetSupport } } } },
      initializationOptions: { fish_lsp_enable_snippets: enableSnippets },
    } });
  });

  afterAll(async () => {
    await handle?.shutdown();
    config.fish_lsp_enable_snippets = originalEnableSnippets;
  });

  it('does not offer snippets', async () => {
    const result = await completeAt('ife');
    expect(result.items.filter(i => i.kind === CompletionItemKind.Snippet)).toEqual([]);
    expect((await completeAt('set color')).items.filter(i => i.kind === CompletionItemKind.Snippet)).toEqual([]);
    expect((await completeAt('if')).items.map(i => i.label)).toContain('if');
  });

  it('sends snippet-format templates as their plain default text', async () => {
    const result = await completeAt('string match -r ');
    const hex = result.items.find(i => i.label === '\\xxx');
    const range = result.items.find(i => i.label.startsWith('[x-y]'));

    expect(hex).toMatchObject({ insertText: '\\xxx', insertTextFormat: InsertTextFormat.PlainText });
    expect(range).toMatchObject({ insertText: '[start-end]', insertTextFormat: InsertTextFormat.PlainText });
    expect(result.items.filter(i => i.insertTextFormat === InsertTextFormat.Snippet)).toEqual([]);
  });

  it('leaves the completion map templates untouched', async () => {
    await completeAt('string match -r ');
    expect(cachedCompletionMap.findLabel('\\xxx', 'esc_chars')).toMatchObject({
      insertText: '\\x${1:xx}',
      insertTextFormat: InsertTextFormat.Snippet,
    });
  });
});
