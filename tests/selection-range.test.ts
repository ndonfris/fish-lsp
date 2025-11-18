import { describe, it, expect, beforeAll } from 'vitest';
import { analyzer, Analyzer } from '../src/analyze';
import { getSelectionRanges } from '../src/selection-range';
import { Position } from 'vscode-languageserver';
import { LspDocument } from '../src/document';

describe('Selection Range', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  it('should expand selection from word to command', async () => {
    const content = 'echo "Hello, World!"';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "echo" (line 0, char 2)
    const position: Position = { line: 0, character: 2 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should start with the word "echo"
    const firstRange = ranges[0]!.range;
    expect(firstRange.start.line).toBe(0);
    expect(firstRange.start.character).toBe(0);
    expect(firstRange.end.character).toBe(4); // "echo"

    // Should have a parent covering the entire command
    expect(ranges[0]!.parent).toBeDefined();
    const parentRange = ranges[0]!.parent!.range;
    expect(parentRange.end.character).toBeGreaterThan(4);
  });

  it('should expand selection in function definition', async () => {
    const content = `function greet --argument name
    echo "Hello, $name!"
end`;
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "greet" function name (line 0, char 10)
    const position: Position = { line: 0, character: 10 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // The function name "greet"
    const firstRange = ranges[0]!.range;
    expect(firstRange.start.line).toBe(0);
    expect(firstRange.start.character).toBe(9);
    expect(firstRange.end.character).toBe(14);

    // Should have parent covering the entire function
    let current = ranges[0]!.parent;
    let foundFunctionDefinition = false;
    while (current) {
      if (current.range.end.line === 2) {
        foundFunctionDefinition = true;
        break;
      }
      current = current.parent;
    }
    expect(foundFunctionDefinition).toBe(true);
  });

  it('should expand selection in variable expansion', async () => {
    const content = 'echo "$HOME"';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    await analyzer.analyze(doc);

    // Position at "HOME" variable (line 0, char 7)
    const position: Position = { line: 0, character: 7 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should select the variable name
    const firstRange = ranges[0]!.range;
    expect(firstRange.start.character).toBeGreaterThanOrEqual(6);
    expect(firstRange.end.character).toBeLessThanOrEqual(11);
  });

  it('should expand selection in if statement', async () => {
    const content = `if test -n "$name"
    echo "Has name"
end`;
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "test" command (line 0, char 4)
    const position: Position = { line: 0, character: 4 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should have hierarchy: word -> command -> if_statement
    let current = ranges[0];
    let depth = 0;
    while (current && depth < 10) {
      current = current.parent;
      depth++;
    }
    expect(depth).toBeGreaterThan(1);
  });

  it('should expand selection in command substitution', async () => {
    const content = 'set result (greet "Alice")';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "greet" inside command substitution (line 0, char 13)
    const position: Position = { line: 0, character: 13 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should select "greet"
    const firstRange = ranges[0]!.range;
    expect(firstRange.start.character).toBe(12);
    expect(firstRange.end.character).toBe(17);

    // Should have parent covering command inside substitution
    expect(ranges[0]!.parent).toBeDefined();
  });

  it('should handle multiple positions', async () => {
    const content = 'echo "Hello" && echo "World"';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Two positions: first "echo" and second "echo"
    const positions: Position[] = [
      { line: 0, character: 2 },
      { line: 0, character: 18 },
    ];
    const ranges = getSelectionRanges(doc, positions);

    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBeDefined();
    expect(ranges[1]).toBeDefined();

    // Both should be "echo" words
    expect(ranges[0]!.range.end.character).toBeLessThanOrEqual(4);
    expect(ranges[1]!.range.start.character).toBeGreaterThanOrEqual(16);
  });

  it('should expand selection in pipeline', async () => {
    const content = 'cat file.txt | grep pattern | head -n 10';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "grep" (line 0, char 16)
    const position: Position = { line: 0, character: 16 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should select "grep"
    const firstRange = ranges[0]!.range;
    expect(firstRange.start.character).toBe(15);
    expect(firstRange.end.character).toBe(19);
  });

  it('should handle nested blocks', async () => {
    const content = `function outer
    function inner
        echo "nested"
    end
end`;
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position at "inner" function name (line 1, char 15)
    const position: Position = { line: 1, character: 15 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should have multiple parents for nested structure
    let current = ranges[0];
    let depth = 0;
    while (current && depth < 10) {
      current = current.parent;
      depth++;
    }
    expect(depth).toBeGreaterThan(2);
  });

  it('should return program node for empty document', async () => {
    const content = '';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    const position: Position = { line: 0, character: 0 };
    const ranges = getSelectionRanges(doc, [position]);

    // Empty document still has a program root node
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.range.start).toEqual({ line: 0, character: 0 });
  });

  it('should handle position at string content', async () => {
    const content = 'echo "Hello, World!"';
    const doc = LspDocument.createTextDocumentItem('file:///test-selection.fish', content);
    analyzer.analyze(doc);

    // Position inside the string (line 0, char 10)
    const position: Position = { line: 0, character: 10 };
    const ranges = getSelectionRanges(doc, [position]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBeDefined();

    // Should eventually expand to the entire command
    let current = ranges[0];
    while (current?.parent) {
      current = current.parent;
    }
    expect(current?.range.end.character).toBeGreaterThanOrEqual(20);
  });
});
