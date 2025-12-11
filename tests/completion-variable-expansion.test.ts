import { CompletionParams, InsertReplaceEdit, TextEdit, Range, CompletionItem } from 'vscode-languageserver';
import { createFakeLspDocument, setupStartupMock, createMockConnection, rangeAsString } from './helpers';
import { documents } from '../src/document';
import { analyzer, Analyzer } from '../src/analyze';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { initializeParser } from '../src/parser';

// Setup startup mocks before importing FishServer
setupStartupMock();

// Now import FishServer after the mock is set up
import FishServer from '../src/server';

const logCompletionItem = (item: CompletionItem) => {
  const textEdit = item.textEdit as TextEdit;
  console.log({
    label: item.label,
    insertText: item.insertText,
    kind: item.kind,
    documentation: item.documentation?.toString().splitNewlines().slice(0, 2).join('\n') + '...',
    labelDetails: item.labelDetails,
    data: item.data,
    detail: item.detail,
    textEdit: {
      newText: textEdit.newText,
      range: rangeAsString(textEdit.range as Range),
    },
  });
};

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

  // Helper function to find PATH variable completions
  const findPathCompletion = (result: any) => {
    return result.items.find((item: any) =>
      item.label === 'PATH' ||
      item.insertText === 'PATH' ||
      item.label?.includes('PATH') && !item.label.includes('ALACRITTY'),
    );
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
          logCompletionItem(variable);
        }
      }
    });
  });
});
