import { CompletionParams, Range, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import { createFakeLspDocument, setupStartupMock, createMockConnection } from './helpers';
import { analyzer, Analyzer } from '../src/analyze';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { initializeParser } from '../src/parser';

// Setup startup mocks before importing FishServer
setupStartupMock();

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
});
