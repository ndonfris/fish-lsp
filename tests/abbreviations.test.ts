import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CompletionItemKind, CompletionTriggerKind, InsertTextFormat } from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import {
  AbbreviationStore,
  abbreviationCompletions,
  abbreviationInsertText,
  abbreviationSortText,
  abbreviationToCompletionItem,
  abbreviationsFromSource,
  escapeSnippetText,
  FishAbbreviation,
  isFishConfigPath,
  readAbbreviationsFromDirectory,
} from '../src/completions/abbreviations';
import { routeFor, toCompletionList } from '../src/completions/handler';
import { fishAbbreviations } from '../src/completions/sources';
import { CompletionItemMap } from '../src/completions/startup-cache';
import { CompletionContext } from '../src/completions/context';
import { FishCompletionItem, FishCompletionItemKind } from '../src/completions/types';
import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';

setLogger();

let parser: Parser;

beforeAll(async () => {
  parser = await initializeParser();
});

function parse(source: string): FishAbbreviation[] {
  return abbreviationsFromSource(source, parser);
}

function item(source: string, name?: string) {
  const abbrs = parse(source);
  const found = name ? abbrs.find(abbr => abbr.name === name) : abbrs[0];
  expect(found, source).toBeDefined();
  return abbreviationToCompletionItem(found!);
}

function context(partial: Partial<CompletionContext>): CompletionContext {
  return {
    doc: { uri: 'file:///tmp/abbr.fish' },
    position: { line: 0, character: 0 },
    line: '',
    commandline: '',
    embedded: false,
    mode: 'empty',
    word: '',
    snippetPrefixes: [],
    canEndCommand: false,
    command: null,
    args: [],
    argIndex: 0,
    replaceLength: 0,
    variablePrefix: '',
    isDefinitionSlot: false,
    symbols: [],
    variables: [],
    functions: [],
    triggerKind: CompletionTriggerKind.Invoked,
    ...partial,
  } as CompletionContext;
}

describe('fish abbreviations', () => {
  describe('parsing', () => {
    it('parses a basic abbreviation', () => {
      const completion = item('abbr --add ga \'git add\'');
      expect(completion.label).toBe('ga');
      expect(completion.insertText).toBe('git add');
      expect(completion.insertTextFormat).toBeUndefined();
      expect(parse('abbr --add ga \'git add\'')[0]).toMatchObject({
        position: 'command',
        commands: [],
      });
    });

    it('parses shorthand -a and ignores the legacy -g flag', () => {
      expect(item('abbr -a ga \'git add\'').insertText).toBe('git add');
      expect(item('abbr -ag nrt \'npm run test\'').insertText).toBe('npm run test');
      expect(item('abbr -a -g nrt \'npm run test\'').label).toBe('nrt');
    });

    it('parses --set-cursor with the default % marker', () => {
      const completion = item('abbr --add gc --set-cursor \'git commit -m "%"\'');
      expect(completion.label).toBe('gc');
      expect(completion.insertText).toBe('git commit -m "$0"');
      expect(completion.insertTextFormat).toBe(InsertTextFormat.Snippet);
    });

    it('parses --set-cursor=% the same way as the default marker', () => {
      const completion = item('abbr -a gco --set-cursor=% \'git checkout %\'');
      expect(completion.insertText).toBe('git checkout $0');
      expect(completion.insertTextFormat).toBe(InsertTextFormat.Snippet);
    });

    it('uses a custom --set-cursor marker and leaves later copies in place', () => {
      const completion = item('abbr -a x --set-cursor=! \'echo ! and !\'');
      expect(completion.insertText).toBe('echo $0 and !');
      expect(completion.insertTextFormat).toBe(InsertTextFormat.Snippet);
    });

    it('keeps a plain expansion when the cursor marker is not in the text', () => {
      const completion = item('abbr -a x --set-cursor=! \'echo done\'');
      expect(completion.insertText).toBe('echo done');
      expect(completion.insertTextFormat).toBeUndefined();
    });

    it('restricts an abbreviation to a command', () => {
      const completion = item('abbr --add st --command git status');
      expect(completion.label).toBe('st');
      expect(completion.insertText).toBe('status');
      expect(completion.detail).toBe('(git) → status');
      expect(completion.data?.abbreviation).toEqual({ position: 'anywhere', commands: ['git'] });
    });

    it('parses shorthand -c, --command=, and attached -cVALUE', () => {
      expect(parse('abbr -a st -c git status')[0]?.commands).toEqual(['git']);
      expect(parse('abbr --command=git co checkout')[0]).toMatchObject({
        name: 'co',
        expansion: 'checkout',
        commands: ['git'],
        position: 'anywhere',
      });
      expect(parse('abbr -cgit co checkout')[0]?.commands).toEqual(['git']);
    });

    it('parses --position anywhere and keeps the default command position', () => {
      expect(parse('abbr -a gs --position anywhere \'git status\'')[0]?.position).toBe('anywhere');
      expect(parse('abbr -a gs --position=anywhere git status')[0]).toMatchObject({
        expansion: 'git status',
        position: 'anywhere',
      });
      expect(parse('abbr -a ga \'git add\'')[0]?.position).toBe('command');
      expect(parse('abbr -a ga --position command \'git add\'')[0]?.position).toBe('command');
    });

    it('keeps one abbreviation that lists several commands', () => {
      const abbrs = parse('abbr -a co --command git --command hg checkout');
      expect(abbrs).toHaveLength(1);
      expect(abbrs[0]).toMatchObject({
        name: 'co',
        expansion: 'checkout',
        commands: ['git', 'hg'],
        position: 'anywhere',
      });
      expect(abbreviationToCompletionItem(abbrs[0]!).detail).toBe('(git, hg) → checkout');
    });

    it('expands --command={git,hg} into both commands', () => {
      expect(parse('abbr --command={git,hg} co checkout')[0]?.commands).toEqual(['git', 'hg']);
    });

    it('lets the last definition win for the same name and commands', () => {
      const abbrs = parse([
        'abbr -a ga \'git add\'',
        'abbr -a ga \'git add -A\'',
      ].join('\n'));
      expect(abbrs).toHaveLength(1);
      expect(abbrs[0]?.expansion).toBe('git add -A');
    });

    it('keeps the same name when the commands differ', () => {
      const abbrs = parse([
        'abbr -a st --command git status',
        'abbr -a st --command hg summary',
      ].join('\n'));
      expect(abbrs.map(abbr => [abbr.commands, abbr.expansion])).toEqual([
        [['git'], 'status'],
        [['hg'], 'summary'],
      ]);
    });

    it('preserves quoted whitespace and literal quotes', () => {
      expect(item('abbr --add msg \'git commit -m "hello world"\'').insertText)
        .toBe('git commit -m "hello world"');
      expect(parse('abbr -a ll \'ls  -l\'')[0]?.expansion).toBe('ls  -l');
    });

    it('joins unquoted expansion words and keeps flags after the second word', () => {
      expect(parse('abbr -a ll ls -l')[0]?.expansion).toBe('ls -l');
      expect(parse('abbr -a e emacs -nw')[0]?.expansion).toBe('emacs -nw');
    });

    it('accepts a name that looks like a flag after --', () => {
      expect(parse('abbr -a --position anywhere -- -C --color')[0]).toMatchObject({
        name: '-C',
        expansion: '--color',
        position: 'anywhere',
      });
    });

    it('escapes snippet characters after the cursor marker is placed', () => {
      expect(escapeSnippetText('a\\b$c}')).toBe('a\\\\b\\$c\\}');
      const completion = item('abbr -a p \'echo $foo } \\\\\'');
      expect(completion.insertText).toBe('echo \\$foo \\} \\\\');
      expect(completion.insertTextFormat).toBe(InsertTextFormat.Snippet);
      expect(abbreviationInsertText('echo $ % }', '%')).toEqual({
        insertText: 'echo \\$ $0 \\}',
        insertTextFormat: InsertTextFormat.Snippet,
      });
    });

    it('does not expand variables inside single quotes', () => {
      const completion = item('abbr -a x \'echo $HOME\'');
      expect(completion.insertText).toBe('echo \\$HOME');
      expect(completion.insertTextFormat).toBe(InsertTextFormat.Snippet);
    });

    it('ignores comments, strings, and abbreviations that are not commands', () => {
      const abbrs = parse([
        '# abbr -a hidden \'nope\'',
        'echo \'abbr -a no way\'',
        'abbr -a real \'yes\'',
      ].join('\n'));
      expect(abbrs.map(abbr => abbr.name)).toEqual(['real']);
    });

    it('reads abbreviations nested under if status is-interactive', () => {
      const abbrs = parse('if status is-interactive\n    abbr -a ga \'git add\'\nend');
      expect(abbrs.map(abbr => abbr.name)).toEqual(['ga']);
    });

    it('skips abbreviations inside a function body', () => {
      const abbrs = parse([
        'if status is-interactive',
        '    abbr -a ga \'git add\'',
        'end',
        'function never_called',
        '    abbr -a gb \'git branch\'',
        'end',
      ].join('\n'));
      expect(abbrs.map(abbr => abbr.name)).toEqual(['ga']);
    });

    it('applies both conditional branches in source order', () => {
      // The condition is not executed. The later definition wins even when Fish
      // would have taken the other branch (`if true` keeps `from-if`).
      const abbrs = parse([
        'if true',
        '    abbr -a x from-if',
        'else',
        '    abbr -a x from-else',
        'end',
      ].join('\n'));
      expect(abbrs.map(abbr => abbr.expansion)).toEqual(['from-else']);
    });

    it('ignores malformed definitions without replacing a previous one', () => {
      const source = [
        'abbr -a ga \'git add\'',
        'abbr --add',
        'abbr --add onlyname',
        'abbr -a --position sideways ga \'git add -A\'',
        'abbr -a --position command --command git st status',
        'abbr -a \'\' \'missing\'',
        'abbr -p anywhere nope \'nope\'',
      ].join('\n');
      expect(parse(source)).toEqual([
        expect.objectContaining({ name: 'ga', expansion: 'git add' }),
      ]);
    });

    it('drops a literal when a later --function or --regex definition replaces it', () => {
      expect(parse([
        'abbr -a gs \'git status\'',
        'abbr -a gs --function git_status',
      ].join('\n'))).toEqual([]);
      expect(parse([
        'abbr -a gs \'git status\'',
        'abbr -a gs --regex \'.+\' \'git status\'',
      ].join('\n'))).toEqual([]);
    });

    it('does not invent a completion for a dynamic expansion', () => {
      expect(parse('abbr -a x (echo hi)')).toEqual([]);
      expect(parse('abbr -a x "echo $HOME"')).toEqual([]);
      expect(parse([
        'abbr -a x \'echo literal\'',
        'abbr -a x (echo hi)',
      ].join('\n'))).toEqual([]);
    });

    it('erases and renames abbreviations the way fish does', () => {
      expect(parse([
        'abbr -a ga \'git add\'',
        'abbr --erase ga',
      ].join('\n'))).toEqual([]);
      expect(parse([
        'abbr -a st --command git status',
        'abbr -a st --command hg summary',
        'abbr --erase --command git st',
      ].join('\n')).map(abbr => abbr.commands)).toEqual([['hg']]);
      expect(parse([
        'abbr -a ga \'git add\'',
        'abbr --rename ga gaa',
      ].join('\n'))[0]).toMatchObject({ name: 'gaa', expansion: 'git add' });
    });
  });

  describe('completion items', () => {
    const source = [
      'abbr --add ga \'git add\'',
      'abbr --add gc --set-cursor \'git commit -m "%"\'',
      'abbr --add gco --set-cursor \'git checkout %\'',
      'abbr --add st --command git status',
      'abbr -a gs --position anywhere \'git status\'',
      'abbr -a co --command git --command hg checkout',
    ].join('\n');

    function listed(mode: CompletionContext['mode'], command: string | null = null) {
      const items = parse(source).map(abbreviationToCompletionItem);
      return abbreviationCompletions(items, mode, command);
    }

    it('offers command-position abbreviations only at the command', () => {
      expect(listed('empty').map(entry => entry.label)).toEqual(['ga', 'gc', 'gco', 'gs']);
      expect(listed('command').map(entry => entry.label)).toContain('ga');
      expect(listed('argument', 'git').map(entry => entry.label)).not.toContain('ga');
      expect(listed('quoted')).toEqual([]);
      expect(listed('variable')).toEqual([]);
    });

    it('offers an anywhere abbreviation in both positions', () => {
      expect(listed('empty').map(entry => entry.label)).toContain('gs');
      expect(listed('argument', 'npm').find(entry => entry.label === 'gs')?.insertText).toBe('git status');
    });

    it('offers a command abbreviation only after that command', () => {
      const git = listed('argument', 'git');
      expect(git.find(entry => entry.label === 'st')).toMatchObject({
        insertText: 'status',
        detail: '(git) → status',
      });
      expect(git.map(entry => entry.label)).toContain('co');
      expect(listed('argument', 'npm').map(entry => entry.label)).not.toEqual(
        expect.arrayContaining(['st', 'co']),
      );
      expect(listed('empty').map(entry => entry.label)).not.toContain('st');
    });

    it('uses the later definition when two abbreviations match the same context', () => {
      const items = parse([
        'abbr -a x --position anywhere first',
        'abbr -a x --command git second',
      ].join('\n')).map(abbreviationToCompletionItem);
      expect(abbreviationCompletions(items, 'argument', 'git').map(entry => entry.insertText)).toEqual(['second']);
      expect(abbreviationCompletions(items, 'argument', 'echo').map(entry => entry.insertText)).toEqual(['first']);
      expect(abbreviationCompletions(items, 'empty', null).map(entry => entry.insertText)).toEqual(['first']);
    });

    it('sets snippet kind, snippet format, and 0_abbr_ sort text', () => {
      const abbrs = parse(source).map(abbreviationToCompletionItem);
      const ga = abbrs.find(entry => entry.label === 'ga')!;
      const gc = abbrs.find(entry => entry.label === 'gc')!;
      expect(ga.kind).toBe(CompletionItemKind.Snippet);
      expect(ga.fishKind).toBe(FishCompletionItemKind.ABBR);
      expect(ga.sortText).toBe('0_abbr_ga');
      expect(abbreviationSortText('st', ['git'])).toBe('0_abbr_st_git');
      expect(gc.insertTextFormat).toBe(InsertTextFormat.Snippet);
      expect(gc.insertText).toBe('git commit -m "$0"');

      const builtin = FishCompletionItem.create('echo', FishCompletionItemKind.BUILTIN, 'builtin', 'echo').setPriority(10);
      const list = toCompletionList(context({ mode: 'empty' }), [builtin, ga, gc], { snippetSupport: true });
      expect(list.items.slice(0, 2).map(entry => entry.label)).toEqual(['ga', 'gc']);
      expect(list.items[0]).toMatchObject({
        kind: CompletionItemKind.Snippet,
        insertText: 'git add',
        sortText: '0_abbr_ga',
      });
      expect(list.items[1]).toMatchObject({
        insertText: 'git commit -m "$0"',
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '0_abbr_gc',
      });
      expect(list.items.at(-1)?.sortText?.startsWith('1_')).toBe(true);
      expect([...list.items].sort((left, right) => left.sortText!.localeCompare(right.sortText!))).toEqual(list.items);
    });

    it('turns a snippet into the text fish would insert when the client has no snippet support', () => {
      const gco = item('abbr --add gco --set-cursor \'git checkout %\'');
      const list = toCompletionList(context({ mode: 'command', word: 'gc' }), [gco], { snippetSupport: false });
      expect(list.items[0]?.insertText).toBe('git checkout ');
      expect(list.items[0]?.insertTextFormat).toBe(InsertTextFormat.PlainText);
    });

    it('is offered from the completion routes that can expand an abbreviation', () => {
      expect(routeFor(context({ mode: 'empty' }))).toContain(fishAbbreviations);
      expect(routeFor(context({ mode: 'command' }))).toContain(fishAbbreviations);
      expect(routeFor(context({ mode: 'argument', command: 'git' }))).toContain(fishAbbreviations);
      expect(routeFor(context({ mode: 'quoted' }))).not.toContain(fishAbbreviations);
      const map = new CompletionItemMap();
      map.setAbbreviations(parse('abbr -a st --command git status').map(abbreviationToCompletionItem));
      expect(fishAbbreviations(context({ mode: 'argument', command: 'git' }), map)).toEqual([
        expect.objectContaining({ label: 'st', insertText: 'status' }),
      ]);
      expect(fishAbbreviations(context({ mode: 'argument', command: 'npm' }), map)).toEqual([]);
    });
  });

  describe('config files', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fish-abbr-'));
      mkdirSync(join(dir, 'conf.d'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('recognizes config.fish and conf.d files', () => {
      expect(isFishConfigPath('/home/user/.config/fish/config.fish')).toBe(true);
      expect(isFishConfigPath('/home/user/.config/fish/conf.d/abbr.fish')).toBe(true);
      expect(isFishConfigPath('/home/user/.config/fish/functions/foo.fish')).toBe(false);
    });

    it('applies conf.d in natural order and lets config.fish win', async () => {
      writeFileSync(join(dir, 'conf.d', '10-later.fish'), 'abbr -a x from-10\nabbr -a only-later true\n');
      writeFileSync(join(dir, 'conf.d', '2-earlier.fish'), 'abbr -a x from-2\nabbr -a only-early true\n');
      writeFileSync(join(dir, 'config.fish'), 'abbr -a x from-config\n');
      const names = await readAbbreviationsFromDirectory(dir);
      expect(names.find(abbr => abbr.name === 'x')?.expansion).toBe('from-config');
      expect(names.map(abbr => abbr.name).sort()).toEqual(['only-early', 'only-later', 'x']);
    });

    it('reloads when a config file changes and keeps the previous list if reading fails', async () => {
      const store = new AbbreviationStore();
      writeFileSync(join(dir, 'config.fish'), 'abbr -a ga \'git add\'\n');
      await store.reload(dir);
      expect(store.abbreviations.map(abbr => abbr.expansion)).toEqual(['git add']);

      writeFileSync(join(dir, 'config.fish'), 'abbr -a ga \'git add -A\'\n');
      await store.reload(dir);
      expect(store.abbreviations.map(abbr => abbr.expansion)).toEqual(['git add -A']);

      await store.reload(dir, () => {
        throw new Error('disk unavailable');
      });
      expect(store.abbreviations.map(abbr => abbr.expansion)).toEqual(['git add -A']);
    });

    it('skips a broken conf.d file and still reads the rest', async () => {
      writeFileSync(join(dir, 'conf.d', 'bad.fish'), '((((\n');
      writeFileSync(join(dir, 'config.fish'), 'abbr -a ga \'git add\'\n');
      const abbrs = await readAbbreviationsFromDirectory(dir);
      expect(abbrs.map(abbr => abbr.name)).toEqual(['ga']);
    });
  });
});
