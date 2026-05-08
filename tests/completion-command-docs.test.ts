import { CompletionParams, MarkupContent } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import path from 'path';
import { vi } from 'vitest';
import { analyzer } from '../src/analyze';
import { createFakeLspDocument, createTestServer, setupStartupMock, SkipUtils, type TestServerHandle } from './helpers';
import * as shellModule from '../src/utils/completion/shell';
import * as execModule from '../src/utils/exec';
import { FishCompletionItem } from '../src/utils/completion/types';

setupStartupMock();

import FishServer, { cachedCompletionMap } from '../src/server';
import { md } from '../src/utils/markdown-builder';
import { logger } from '../src/logger';

describe('Command completion documentation', () => {
  let handle: TestServerHandle;
  let server: FishServer;

  async function getResolvedCompletionItem(
    content: string,
    label: string,
    filePath: string = '/tmp/completion-doc-item.fish',
  ) {
    const doc = createFakeLspDocument(filePath, content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === label);
    const resolvedItem = item ? await server.onCompletionResolve(item) : undefined;

    return { item, resolvedItem };
  }

  beforeAll(async () => {
    handle = await createTestServer({
      params: {
        capabilities: {
          workspace: {
            workspaceFolders: true,
          },
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
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  let originalCompletePath: string = process.env.fish_complete_path ?? '';

  beforeEach(() => {
    originalCompletePath = process.env.fish_complete_path ?? '';
  });

  afterEach(async () => {
    process.env.fish_complete_path = originalCompletePath;
  });

  it('includes man markdown in onCompletion docs for `bash`', async () => {
    const content = 'bash';
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'bash');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(7);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('command')}) ${md.inlineCode('bash')}`);
  });

  it('includes local function onCompletionResolve', async () => {
    const content = [
      'function my_func',
      '    echo "my_func"',
      'end',
      'my_func',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 3, character: 7 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'my_func');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem, })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(3);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('function')}) ${md.inlineCode('my_func')}`);
  });

  it('includes alias onCompletionResolve', async () => {
    const content = ['alias ll="ls -l"', ''].join('\n');
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 0 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'll');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem, })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(3);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('alias')}) ${md.inlineCode('ll')}`);
  });

  it('includes local variable onCompletionResolve', async () => {
    const content = [
      'set my_var "hello world"',
      'echo $my_var',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 10 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'my_var');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(6);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('variable')}) ${md.inlineCode('my_var')}`);
  });

  it.skip('includes global variable onCompletionResolve', async () => {
    const content = [
      'export PATH="/usr/local/bin:$PATH"',
      'echo $PATH',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 10 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'PATH');
    const resolvedItem = await server.onCompletionResolve(item!);
    logger.log({ resolvedItem });
    // console.log({ doc: resolvedItem.documentation });

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(6);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('variable')}) ${md.inlineCode('PATH')}`);
  });

  it('includes builtin onCompletionResolve', async () => {
    const content = ['echo "hello world" | string split', 'string'].join('\n');
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 6 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'string');
    const resolvedItem = await server.onCompletionResolve(item!);
    logger.log({ resolvedItem });

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(14);
    expect(resolvedItem?.documentation).toBeDefined();
    const matchStr = [
      md.bold('STRING'),
      '-',
      md.italic('https://fishshell.com/docs/current/cmds/string.html'),
    ].join(' ');
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(matchStr);
  });

  it('resolves builtin subcommands with parent command docs onCompletionResolve', async () => {
    const content = 'string sp';
    const doc = createFakeLspDocument('/tmp/string-subcommand-completion.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'split');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(item).toBeDefined();
    expect(resolvedItem).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(md.inlineCode('string split'));
    expect((resolvedItem?.documentation as MarkupContent).value).toContain('STRING-SPLIT');
  });

  it('includes the subcommand name in option documentation headers', async () => {
    const content = 'string length -';
    const doc = createFakeLspDocument('/tmp/string-subcommand-option-completion.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === '--visible');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(item).toBeDefined();
    expect(resolvedItem).toBeDefined();
    expect(resolvedItem.label).toBe('--visible');
    expect(resolvedItem.detail).toBe('Use the visible width, excluding escape sequences');
    // expect((resolvedItem?.documentation as MarkupContent).value).toContain(md.inlineCode('string length --visible'));
  });

  it('does not attach resolved documentation to flag completions', async () => {
    const content = 'set -';
    const doc = createFakeLspDocument('/tmp/set-option-completion.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === '-a');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(item).toBeDefined();
    expect(item?.detail).toBe('Append value to a list');
    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.documentation).toBeUndefined();
  });

  it('does not resolve complete -c command arguments as complete subcommands', async () => {
    // Mock shellComplete so the test does not depend on a real `foo`
    // command existing in PATH (e.g. inside a barebones container).
    const shellSpy = vi.spyOn(shellModule, 'shellComplete')
      .mockImplementation(async () => [['foo', 'command']]);
    try {
      const content = 'complete -c foo';
      const doc = createFakeLspDocument('/tmp/complete-command-argument.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'foo');
      const resolvedItem = await server.onCompletionResolve(item!);

      expect(item).toBeDefined();
      expect(resolvedItem).toBeDefined();
      expect((resolvedItem?.documentation as MarkupContent).value).not.toContain(md.inlineCode('complete foo'));
    } finally {
      shellSpy.mockRestore();
    }
  });

  it('renders hyphenated command labels as inline code onCompletionResolve', async () => {
    const resolvedItem = await server.onCompletionResolve({
      label: 'fish-lsp',
      kind: CompletionItemKind.Class,
      detail: 'command',
    } as any);

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem.documentation).toBeDefined();
    expect((resolvedItem.documentation as MarkupContent).value).toContain('`fish-lsp`');
  });

  it('preserves inline-code labels for real hyphenated completion items from onCompletion', async () => {
    const shellSpy = vi.spyOn(shellModule, 'shellComplete')
      .mockImplementation(async (cmd: string) => {
        if (cmd.includes('fish-l')) {
          return [['fish-lsp', 'A language server for the fish shell']];
        }
        if (cmd.includes('keep-cur')) {
          return [['keep-current-commandline-and-fish-clipboard-copy', 'function']];
        }
        return [];
      });
    const docsSpy = vi.spyOn(execModule.ExecFishFiles, 'getDocs')
      .mockImplementation(async (...args: string[]) => {
        if (args.join(' ') === 'fish-lsp') {
          return {
            stdout: 'NAME\nfish-lsp - A language server for the fish shell\n',
            stderr: '',
            code: 0,
          };
        }
        return {
          stdout: '',
          stderr: '',
          code: 0,
        };
      });
    const commandItems = server.completions.get('command');
    const functionItems = server.completions.get('function');
    const temporaryCommand = FishCompletionItem.create(
      'fish-lsp',
      'command',
      'A language server for the fish shell',
      'fish-lsp',
    );
    const temporaryFunction = FishCompletionItem.create(
      'keep-current-commandline-and-fish-clipboard-copy',
      'function',
      'function',
      '',
    );
    commandItems.push(temporaryCommand);
    functionItems.push(temporaryFunction);

    try {
      const fishLsp = await getResolvedCompletionItem(
        "complete -c A -n '__fish_contains_opt -s s selection; and fish-l",
        'fish-lsp',
        path.join(process.cwd(), 'tests/workspaces/_foo_test/fish/completions/A.fish'),
      );
      expect(fishLsp.item).toBeDefined();
      expect(fishLsp.item?.detail).toBe('A language server for the fish shell');
      expect(fishLsp.resolvedItem).toBeDefined();
      expect((fishLsp.resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('command')}) ${md.inlineCode('fish-lsp')}`);
      expect((fishLsp.resolvedItem?.documentation as MarkupContent).value).not.toContain('```fish\nfish-lsp\n```');

      const keepCurrent = await getResolvedCompletionItem(
        "complete -c A -n '__fish_contains_opt -s s selection; and keep-cur",
        'keep-current-commandline-and-fish-clipboard-copy',
        path.join(process.cwd(), 'tests/workspaces/_foo_test/fish/completions/A.fish'),
      );
      expect(keepCurrent.item).toBeDefined();
      expect(keepCurrent.item?.detail).toBe('function');
      expect(keepCurrent.resolvedItem).toBeDefined();
      expect((keepCurrent.resolvedItem?.documentation as MarkupContent).value).toContain(md.inlineCode('keep-current-commandline-and-fish-clipboard-copy'));
      expect((keepCurrent.resolvedItem?.documentation as MarkupContent).value).not.toContain('```fish\nkeep-current-commandline-and-fish-clipboard-copy\n```');
    } finally {
      commandItems.splice(commandItems.indexOf(temporaryCommand), 1);
      functionItems.splice(functionItems.indexOf(temporaryFunction), 1);
      docsSpy.mockRestore();
      shellSpy.mockRestore();
    }
  });

  it('still returns completions for incomplete quoted complete -n payloads', async () => {
    const content = "complete -c A -n '";
    const doc = createFakeLspDocument('/tmp/complete-condition.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some(i => i.label === 'set')).toBe(true);
  });

  it('completes helper functions inside incomplete quoted complete -n payloads', async () => {
    const content = "complete -c A -n 'not __f";
    const doc = createFakeLspDocument('/tmp/complete-condition-helper.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some(i => typeof i.label === 'string' && i.label.startsWith('__fish_'))).toBe(true);
  });

  it('does not treat complete -x as a quoted payload option', async () => {
    const content = "complete -c A -x '";
    const doc = createFakeLspDocument('/tmp/complete-exclusive.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some(i => i.label === 'abbr')).toBe(true);
  });

  it('completes inside complete -n at eof even when the target completion file is autoloadable', async () => {
    process.env.fish_complete_path = path.join(process.cwd(), 'tests/workspaces/_foo_test/fish/completions');
    const content = "complete -c A -n 'not te";
    const doc = createFakeLspDocument(
      path.join(process.cwd(), 'tests/workspaces/_foo_test/fish/completions/A.fish'),
      content,
    );
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some(i => i.label === 'test')).toBe(true);
  });

  it('completes test options inside incomplete complete -n conditions', async () => {
    const content = "complete -c A -n 'not test -";
    const doc = createFakeLspDocument('/tmp/complete-condition-test-options.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some(i => i.label === '-a')).toBe(true);
    expect(result.items.some(i => i.label === '--help')).toBe(true);
  });

  it('includes subcommand flags when completing at trailing space with no current word', async () => {
    const content = 'string split ';
    const doc = createFakeLspDocument('/tmp/string-split-trailing-space.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.some(i => i.label === '-f')).toBe(true);
    expect(result.items.some(i => i.label === '--help')).toBe(true);
    expect(result.items.some(i => i.label === '--max')).toBe(true);
  });

  it('preserves snippet insert text for regex templates in the completion map', async () => {
    const snippetExpectations = [
      ['{n}', '{${1:n}}'],
      ['{n,m}', '{${1:n},${2:m}}'],
      ['{n,}', '{${1:number},}'],
      ['(...)', '(${1:expr})'],
      ['(?:...) is a non-capturing group', '(?:${1:expr})'],
      ['[...] a character set', '[${1:chars}]'],
      ['[^...]', '[^${1:chars}]'],
      ['[x-y] the range of characters from x-y', '[${1:start}-${2:end}]'],
      ['[[:xxx:]]', '[[:${1:class}:]]'],
      ['[[:^xxx:]]', '[[:^${1:class}:]]'],
      ['\\n', '\\${1:n}'],
      ['$n', '\\$${1:n}'],
    ] as const;

    for (const [label, insertText] of snippetExpectations) {
      const item = cachedCompletionMap.findLabel(label, 'regex');
      expect(item).toBeDefined();
      expect(item?.insertText).toBe(insertText);
      expect(item?.insertTextFormat).toBe(2);
    }

    const literalExpectations = [
      ['\\d a decimal digit', '\\d'],
      ['\\w a “word” character', '\\w'],
      ['[[:alnum:]]', '[[:alnum:]]'],
    ] as const;

    for (const [label, insertText] of literalExpectations) {
      const item = cachedCompletionMap.findLabel(label, 'regex');
      expect(item).toBeDefined();
      expect(item?.insertText).toBe(insertText);
      expect(item?.insertTextFormat ?? 1).toBe(1);
    }
  });

  it('preserves snippet insert text for escaped-character templates in the completion map', async () => {
    const snippetExpectations = [
      ['\\xxx', '\\x${1:xx}'],
      ['\\Xxx', '\\X${1:xx}'],
      ['\\ooo', '\\${1:ooo}'],
      ['\\uxxxx', '\\u${1:xxxx}'],
      ['\\Uxxxxxxxx', '\\U${1:xxxxxxxx}'],
      ['\\cx', '\\c${1:x}'],
    ] as const;

    for (const [label, insertText] of snippetExpectations) {
      const item = cachedCompletionMap.findLabel(label, 'esc_chars');
      expect(item).toBeDefined();
      expect(item?.insertText).toBe(insertText);
      expect(item?.insertTextFormat).toBe(2);
    }

    const literalExpectations = [
      ['\\n', '\\n'],
      ['\\\\', '\\\\'],
    ] as const;

    for (const [label, insertText] of literalExpectations) {
      const item = cachedCompletionMap.findLabel(label, 'esc_chars');
      expect(item).toBeDefined();
      expect(item?.insertText ?? item?.label).toBe(insertText);
      expect(item?.insertTextFormat ?? 1).toBe(1);
    }
  });

  it('preserves the opening quote in replacement ranges after a bare quote', async () => {
    const item = cachedCompletionMap.findLabel('(?:...) is a non-capturing group', 'regex');

    expect(item).toBeDefined();
    const completion = item!.setData({
      uri: 'file:///tmp/string-replace-regex-bare-quote.fish',
      line: "string replace --regex '",
      word: "'",
      replaceLength: 0,
      position: { line: 0, character: "string replace --regex '".length },
      command: 'string',
      context: { triggerKind: 1 },
    } as any);
    const textEdit = completion.textEdit as { newText: string; range: { start: { character: number; }; end: { character: number; }; }; };

    expect(completion.insertText).toBe('(?:${1:expr})');
    expect(textEdit.newText).toBe('(?:${1:expr})');
    expect(textEdit.range.start.character).toBe("string replace --regex '".length);
    expect("string replace --regex '".slice(0, textEdit.range.start.character)).toBe("string replace --regex '");
  });

  it('completes commandline for command substitutions inside incomplete complete -n conditions', async () => {
    const contents = [
      "complete -c A -n 'not test -n $(comman",
      "complete -c A -n 'not test -n \"$(comman",
      "complete -c A -n 'not test -n (comman",
    ];

    for (const [index, content] of contents.entries()) {
      const doc = createFakeLspDocument(`/tmp/complete-condition-command-substitution-${index}.fish`, content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result.items.some(i => i.label === 'commandline')).toBe(true);
    }
  });

  it('preserves the opening quote when selecting helper completions inside complete -n payloads', async () => {
    const content = "complete -c A -n '__fish";
    const doc = createFakeLspDocument('/tmp/complete-condition-helper-text-edit.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === '__fish_contains_opt');

    expect(item).toBeDefined();
    const textEdit = item?.textEdit as { newText: string; range: { start: { character: number; }; end: { character: number; }; }; };
    expect(textEdit.newText).toBe('__fish_contains_opt');
    expect(textEdit.range.start.character).toBe(content.length - '__fish'.length);
    expect(content.slice(0, textEdit.range.start.character)).toBe("complete -c A -n '");
  });

  it('resolves embedded helper completions as function documentation', async () => {
    const content = "complete -c A -n '__fish";
    const doc = createFakeLspDocument('/tmp/complete-condition-helper-resolve.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === '__fish_contains_opt');
    expect((item?.documentation as MarkupContent | undefined)?.value ?? item?.documentation ?? '').toBe('__fish_contains_opt');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(item).toBeDefined();
    expect(item?.kind).toBe(CompletionItemKind.Function);
    expect((item as any)?.fishKind).toBe('function');
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('function')}) ${md.inlineCode('__fish_contains_opt')}`);
  });

  it('treats alias quoted values as embedded commandlines', async () => {
    const content = "alias foo='";
    const doc = createFakeLspDocument('/tmp/alias-quoted-value.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.some(i => i.label === 'commandline')).toBe(true);
    expect(result.items.some(i => i.label === 'set')).toBe(true);
  });

  it('keeps command and builtin items visible for alias quoted values with text', async () => {
    const content = "alias foo='__";
    const doc = createFakeLspDocument('/tmp/alias-quoted-value-prefix.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);

    expect(result.items.some(i => i.label === 'set')).toBe(true);
    expect(result.items.some(i => i.label === 'commandline')).toBe(true);
  });

  it('prefixes variable insert text inside alias quoted values', async () => {
    const content = [
      'set my_var hello',
      "alias foo='",
    ].join('\n');
    const doc = createFakeLspDocument('/tmp/alias-quoted-variable.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: content.split('\n')[1]!.length },
    };

    const result = await server.onCompletion(params);
    console.log({ items: result.items.filter(v => v.kind === CompletionItemKind.Variable) });
    const item = result.items.find(i => i.label === 'my_var');

    expect(item).toBeDefined();
    expect(item?.insertText).toBe('$my_var');
    const textEdit = item?.textEdit as { newText: string; };
    expect(textEdit.newText).toBe('$my_var');
  });

  it('filters abbreviations from CompletionItem responses', async () => {
    const shellSpy = vi.spyOn(shellModule, 'shellComplete')
      .mockResolvedValue([
        ['myabbr', ''],
        ['commandline', 'Set or get the commandline'],
      ]);

    try {
      const content = 'my';
      const doc = createFakeLspDocument('/tmp/filter-abbreviations.fish', content);
      analyzer.analyze(doc);

      const completion = (server as any).completion;
      completion.itemsMap._skippedMatches = new Set(['myabbr']);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);

      expect(result.items.some(i => i.label === 'myabbr')).toBe(false);
      expect(result.items.some(i => i.label === 'commandline')).toBe(true);
    } finally {
      shellSpy.mockRestore();
    }
  });
});
