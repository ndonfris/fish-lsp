import { CompletionParams, Range, CompletionItemKind, MarkupContent, Position } from 'vscode-languageserver';
import { createFakeLspDocument, createMockConnection } from './helpers';
import { analyzer, Analyzer } from '../src/analyze';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { initializeParser } from '../src/parser';
import { CompletionPager } from '../src/utils/completion/pager';
import { InlineParser } from '../src/utils/completion/inline-parser';
import { logger } from '../src/logger';

// Now import FishServer after the mock is set up
import FishServer from '../src/server';

describe('Completion Handler - Variable Expansion', () => {
  let server: FishServer;

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();

    // Create mock connection
    const mockConnection = createMockConnection();

    const mockInitializeParams = {
      processId: 1234,
      rootUri: 'file:///test/workspace',
      rootPath: '/test/workspace',
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
      workspaceFolders: [],
    };

    const result = await FishServer.create(mockConnection, mockInitializeParams as any);
    server = result.server;
    server.backgroundAnalysisComplete = true; // Enable completions
  });

  afterEach(() => {
    server?.dispose();
    analyzer.diagnostics.clear();
  });

  // Helper function to find PATH variable completions
  const findPathCompletion = (result: any) => {
    return result.items.find((item: any) =>
      item.label === 'PATH' ||
      item.insertText === 'PATH' ||
      item.label?.includes('PATH') && !item.label.includes('ALACRITTY'),
    );
  };

  const getLineAt = (content: string, line: number) => content.split('\n')[line]!;
  const getVariableItem = async (content: string, line = 1) => {
    const doc = createFakeLspDocument('test.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line, character: getLineAt(content, line).length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'v');
    expect(item).toBeDefined();
    return item!;
  };

  describe('Variable completion for $PATH with various prefixes', () => {
    it('should complete echo $$PA to echo $$PATH', async () => {
      const content = 'echo $$PA';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });

    it('should complete echo $ to echo $PATH', async () => {
      const content = 'echo $';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });

    it('should complete echo $P to echo $PATH', async () => {
      const content = 'echo $P';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });

    it('should complete echo $$$P to echo $$$PATH', async () => {
      const content = 'echo $$$P';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });
  });

  describe('Variable completion edge cases', () => {
    it('should handle quoted variable completion: echo "$P', async () => {
      const content = 'echo "$P';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });

    it('should handle multiline completions', async () => {
      const content = 'if test\n  echo $P';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 }, // At the end of $P in second line
      };

      const result = await server.onCompletion(params);
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);

      const pathItem = findPathCompletion(result);
      expect(pathItem).toBeDefined();
    });

    it('should preserve dollar-prefixed variable completions inside complete -n payloads', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '$",
      ].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: getLineAt(content, 1).length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'v');

      expect(item).toBeDefined();
      expect(item?.kind).toBe(CompletionItemKind.Variable);

      const textEdit = item?.textEdit as { newText: string; range: Range; };
      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '");

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
      expect((resolvedItem?.documentation as MarkupContent).value).toContain('v');
    });

    it('should complete command substitutions for complete -n payloads starting with $(', async () => {
      const content = "complete -c A -n '$(";
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'commandline');

      expect(item).toBeDefined();
      expect(item?.kind).toBe(CompletionItemKind.Keyword);

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve dollar-prefixed variable completions for unquoted complete -n payloads', async () => {
      const content = [
        'set -g v value',
        'complete -c A -n $',
      ].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: getLineAt(content, 1).length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'v');

      expect(item).toBeDefined();
      const textEdit = item?.textEdit as { newText: string; range: Range; };
      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe('complete -c A -n ');
    });

    it('should preserve variable completions inside command substitutions within quoted complete -n payloads', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '($",
      ].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: getLineAt(content, 1).length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'v');

      expect(item).toBeDefined();
      const textEdit = item?.textEdit as { newText: string; range: Range; };
      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '(");

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve braced variable completions inside quoted complete -n payloads', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '${",
      ].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: getLineAt(content, 1).length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'v');

      expect(item).toBeDefined();
      const textEdit = item?.textEdit as { newText: string; range: Range; };
      expect(textEdit.newText).toBe('v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '${");

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve braced variable completions inside unquoted complete -n payloads', async () => {
      const content = [
        'set -g v value',
        'complete -c A    -n ${',
      ].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: getLineAt(content, 1).length },
      };

      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === 'v');

      expect(item).toBeDefined();
      const textEdit = item?.textEdit as { newText: string; range: Range; };
      expect(textEdit.newText).toBe('v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe('complete -c A    -n ${');

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve array index brackets inside quoted complete -n payloads', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '$argv[$",
      ].join('\n');
      const item = await getVariableItem(content);
      const textEdit = item.textEdit as { newText: string; range: Range; };

      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '$argv[");

      const resolvedItem = await server.onCompletionResolve(item);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve range separators inside array index variable completions', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '$argv[-1..$",
      ].join('\n');
      const item = await getVariableItem(content);
      const textEdit = item.textEdit as { newText: string; range: Range; };

      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '$argv[-1..");

      const resolvedItem = await server.onCompletionResolve(item);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve list separators inside array index variable completions', async () => {
      const content = [
        'set -g v value',
        "complete -c A -n '$argv[1 2 $",
      ].join('\n');
      const item = await getVariableItem(content);
      const textEdit = item.textEdit as { newText: string; range: Range; };

      expect(textEdit.newText).toBe('$v');
      expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - '$'.length);
      expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe("complete -c A -n '$argv[1 2 ");

      const resolvedItem = await server.onCompletionResolve(item);
      expect(resolvedItem?.documentation).toBeDefined();
    });
  });

  describe('Completion triggers variable expansion mode', () => {
    it('should properly detect variable expansion context patterns', async () => {
      const testCases = [
        { content: 'echo $$PA', pos: { line: 0, character: 9 } },
        { content: 'echo $', pos: { line: 0, character: 6 } },
        { content: 'echo $P', pos: { line: 0, character: 7 } },
        { content: 'echo $$$P', pos: { line: 0, character: 9 } },
      ];

      for (const testCase of testCases) {
        const doc = createFakeLspDocument('test.fish', testCase.content);
        analyzer.analyze(doc);

        const result = await server.onCompletion({
          textDocument: { uri: doc.uri },
          position: testCase.pos,
        });

        // All cases should return variable completions
        expect(result.items.length).toBeGreaterThan(0);
        // Should contain variables, not just commands
        const hasVariables = result.items.some(item => item.kind === 6); // SymbolKind.Variable
        expect(hasVariables).toBe(true);
      }
    });

    it('$XDG_', async () => {
      const testCases = [
        { content: 'echo $X', pos: { line: 0, character: 7 } },
        { content: 'echo $XDG', pos: { line: 0, character: 9 } },
        { content: 'echo $XDG_', pos: { line: 0, character: 10 } },
      ];
      for (const testCase of testCases) {
        const doc = createFakeLspDocument('test.fish', testCase.content);
        analyzer.analyze(doc);

        const result = await server.onCompletion({
          textDocument: { uri: doc.uri },
          position: testCase.pos,
        });
        expect(result.items.length).toBeGreaterThan(0);
        // Should contain variables, not just commands
        const hasVariables = result.items.some(item => item.kind === 6); // SymbolKind.Variable
        expect(hasVariables).toBe(true);
        const variableCompletions = result.items.filter((item: any) => {
          return item.kind === 6;
        });
        for (const variable of variableCompletions) {
          if (!variable.label.startsWith('XDG_')) continue;
          const textEdit = variable.textEdit as { newText: string; range: Range; };
          expect(textEdit.range.start.character).toBe(6);
        }
      }
    });
  });

  describe('Variable completion outside complete -n payloads', () => {
    it('should complete command substitutions starting with $(', async () => {
      const content = 'echo $(';
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const result = await server.onCompletion({
        textDocument: { uri: doc.uri },
        position: { line: 0, character: content.length },
      });
      const item = result.items.find(i => i.label === 'commandline');

      expect(item).toBeDefined();
      expect(item?.kind).toBe(CompletionItemKind.Keyword);

      const resolvedItem = await server.onCompletionResolve(item!);
      expect(resolvedItem?.documentation).toBeDefined();
    });

    it('should preserve variable expansion delimiters in normal command lines', async () => {
      const testCases = [
        {
          line: 'echo ${',
          expectedText: 'v',
          expectedPrefix: 'echo ${',
          replaceLength: 0,
        },
        {
          line: 'echo $argv[$',
          expectedText: '$v',
          expectedPrefix: 'echo $argv[',
          replaceLength: 1,
        },
        {
          line: 'echo "$argv[1 2 $',
          expectedText: '$v',
          expectedPrefix: 'echo "$argv[1 2 ',
          replaceLength: 1,
        },
        {
          line: 'echo $argv[-1..$',
          expectedText: '$v',
          expectedPrefix: 'echo $argv[-1..',
          replaceLength: 1,
        },
      ];

      for (const testCase of testCases) {
        const content = [
          'set -g v value',
          testCase.line,
        ].join('\n');
        const item = await getVariableItem(content);
        const textEdit = item.textEdit as { newText: string; range: Range; };

        expect(textEdit.newText).toBe(testCase.expectedText);
        expect(textEdit.range.start.character).toBe(getLineAt(content, 1).length - testCase.replaceLength);
        expect(getLineAt(content, 1).slice(0, textEdit.range.start.character)).toBe(testCase.expectedPrefix);

        const resolvedItem = await server.onCompletionResolve(item);
        expect(resolvedItem?.documentation).toBeDefined();
      }
    });
  });

  // A variable completion item inserts a `$`-prefixed expansion at reference
  // slots (`ls <TAB>` -> `ls $myvar`) but a plain name at definition / bare-name
  // slots (`set <TAB>`, `set -e/-q/-S <TAB>`, the `set NAME` slot). The
  // definition-vs-reference decision itself is unit-tested in
  // `variable-completion-context.test.ts`; here we assert the end-to-end insert
  // text produced by `onCompletion`.
  describe('`$` prefix for variable items', () => {
    // Resolve the completion item for the local `myvar` definition at the cursor
    // (end of `lastLine`), returning its effective inserted text.
    async function insertTextFor(lastLine: string, name = 'myvar'): Promise<string | undefined> {
      const content = ['set -gx myvar 1', lastLine].join('\n');
      const doc = createFakeLspDocument('test.fish', content);
      analyzer.analyze(doc);

      const params: CompletionParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: lastLine.length },
      };
      const result = await server.onCompletion(params);
      const item = result.items.find(i => i.label === name || i.label === `$${name}`);
      if (!item) return undefined;
      return (item.insertText ?? item.label) as string;
    }

    it('`ls <TAB>` -> reference slot inserts `$myvar`', async () => {
      expect(await insertTextFor('ls ')).toBe('$myvar');
    });

    it('`set -gx myvar <TAB>` -> value slot inserts `$myvar`', async () => {
      expect(await insertTextFor('set -gx myvar ')).toBe('$myvar');
    });

    it('`set <TAB>` -> definition slot inserts plain `myvar`', async () => {
      expect(await insertTextFor('set ')).toBe('myvar');
    });

    it('`set -gx <TAB>` -> definition slot inserts plain `myvar`', async () => {
      expect(await insertTextFor('set -gx ')).toBe('myvar');
    });

    it('`set -e/-q/-S/--erase <TAB>` -> bare-name target inserts plain `myvar`', async () => {
      expect(await insertTextFor('set -e ')).toBe('myvar');
      expect(await insertTextFor('set -q ')).toBe('myvar');
      expect(await insertTextFor('set -S ')).toBe('myvar');
      expect(await insertTextFor('set --erase ')).toBe('myvar');
    });

    it('`echo $<TAB>` -> already `$`-prefixed, no double `$`', async () => {
      const insertText = await insertTextFor('echo $myv');
      expect(insertText).toBeDefined();
      expect(insertText).toContain('myvar');
      expect(insertText).not.toContain('$$');
    });
  });
});

// Unit tests for the pager's definition-vs-reference decision
// (`isInVariableDefinitionContext`). The end-to-end insert-text consequences of
// this decision are asserted in the `` `$` prefix for variable items `` block
// above; here we exercise the decision directly across `set`/`read`/`for`/
// `function`/`argparse` shapes without standing up a server.
describe('variable completion definition-context detection', () => {
  let pager: CompletionPager;

  beforeAll(async () => {
    logger.setSilent(true);
    const inline = await InlineParser.create();
    // `isInVariableDefinitionContext` only uses the inline parser, so the items
    // map is irrelevant here.
    pager = new CompletionPager(inline, {} as any, logger);
  });

  const isDefinitionSlot = (line: string): boolean =>
    (pager as any).isInVariableDefinitionContext(line, Position.create(0, line.length));

  it('treats the `set NAME` slot as a definition (plain name)', () => {
    expect(isDefinitionSlot('set ')).toBe(true);          // empty name slot
    expect(isDefinitionSlot('set -gx ')).toBe(true);      // empty name slot after options
    expect(isDefinitionSlot('set -gx na')).toBe(true);    // typing the name
    expect(isDefinitionSlot('set foo')).toBe(true);
  });

  it('treats the `set NAME VALUE` slot as a reference (`$`-expansion)', () => {
    expect(isDefinitionSlot('set -gx name ')).toBe(false);   // empty value slot
    expect(isDefinitionSlot('set -gx name va')).toBe(false); // typing a value
    expect(isDefinitionSlot('set name value ')).toBe(false); // second value slot
  });

  it('treats `set -q/-e/-S` operands as plain variable names (no `$`)', () => {
    // `set -q argv` queries the name `argv`; `set -q $argv` would query the
    // expansion, which is wrong. Same for erase/show.
    expect(isDefinitionSlot('set -q ')).toBe(true);
    expect(isDefinitionSlot('set -q ar')).toBe(true);
    expect(isDefinitionSlot('set -lq ')).toBe(true);
    expect(isDefinitionSlot('set -q VAR1 ')).toBe(true);  // multiple names
    expect(isDefinitionSlot('set -e ')).toBe(true);
    expect(isDefinitionSlot('set -S ')).toBe(true);
  });

  it('treats `read` operands as variable names, but not option values', () => {
    expect(isDefinitionSlot('read ')).toBe(true);        // empty name slot
    expect(isDefinitionSlot('read na')).toBe(true);      // typing a name
    expect(isDefinitionSlot('read -l ')).toBe(true);     // after a modifier
    expect(isDefinitionSlot('read foo ')).toBe(true);    // a second name
    expect(isDefinitionSlot('read -p ')).toBe(false);    // the prompt is a value, not a name
  });

  it('treats only the `for` loop variable as a definition', () => {
    expect(isDefinitionSlot('for ')).toBe(true);         // loop-var slot
    expect(isDefinitionSlot('for x')).toBe(true);        // typing the loop var
    expect(isDefinitionSlot('for x ')).toBe(false);      // the `in` keyword slot
    expect(isDefinitionSlot('for x in ')).toBe(false);   // values are references
  });

  it('treats `function --argument-names` operands as definitions, not its other args', () => {
    expect(isDefinitionSlot('function foo --argument-names ')).toBe(true);
    expect(isDefinitionSlot('function foo --argument-names a ')).toBe(true);
    expect(isDefinitionSlot('function foo -a b ')).toBe(true);           // `-a` short form
    expect(isDefinitionSlot("function foo --argument-names a -d 'x' ")).toBe(false); // moved to -d
    expect(isDefinitionSlot('function foo ')).toBe(false);               // function name, not a var
    expect(isDefinitionSlot('function foo -d ')).toBe(false);            // description value
  });

  it('treats `argparse ... -- $argv` operands after `--` as references', () => {
    expect(isDefinitionSlot("argparse 'h/help' -- ")).toBe(false);
    expect(isDefinitionSlot("argparse 'h/help' -- $")).toBe(false);
  });
});
