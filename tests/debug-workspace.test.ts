import { LspDocument } from '../src/document';
import { debugWorkspaceDocument, logTreeSitterDocumentDebug } from '../src/utils/debug-workspace';
import { analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';

describe('debugWorkspaceDocument', () => {
  beforeAll(async () => {
    // Initialize the analyzer with a parser
    const parser = await initializeParser();
    analyzer.parser = parser;
  });

  it('should return both source and parse tree for a simple fish script', () => {
    const fishCode = `function greet
    echo "Hello World"
end`;

    const document = LspDocument.createTextDocumentItem('file:///test.fish', fishCode);
    const result = debugWorkspaceDocument(document);

    expect(result.source).toBe(fishCode);
    expect(result.parseTree).toContain('(program');
    expect(result.parseTree).toContain('function_definition');
    expect(result.parseTree).toContain('greet');
    expect(result.parseTree).toContain('Hello World');
  });

  it('should handle empty documents', () => {
    const document = LspDocument.createTextDocumentItem('file:///empty.fish', '');
    const result = debugWorkspaceDocument(document);

    expect(result.source).toBe('');
    expect(result.parseTree).toContain('(program');
  });

  it('should print debug output without errors', () => {
    const fishCode = 'set var "value"';
    const document = LspDocument.createTextDocumentItem('file:///test.fish', fishCode);

    // Capture console output
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message: string) => logs.push(message);

    expect(() => logTreeSitterDocumentDebug(document)).not.toThrow();

    console.log = originalLog;

    // Verify some expected output patterns
    const output = logs.join('\n');
    expect(output).toContain('DEBUG: test.fish');
    expect(output).toContain('SOURCE:');
    expect(output).toContain('PARSE TREE:');
    expect(output).toContain('set var "value"');
  });
});
