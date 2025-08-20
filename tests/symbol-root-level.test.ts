import { describe, expect, test, beforeAll } from 'vitest';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import { initializeParser } from '../src/parser';
import { symbolsFromResource } from '../src/parsing/source';
import { setLogger } from './helpers';

describe('Symbol Root Level Detection', () => {
  let parser: Parser;
  let analyzer: Analyzer;

  setLogger();

  beforeAll(async () => {
    parser = await initializeParser();
    analyzer = await Analyzer.initialize();
  });

  test('should correctly identify root level vs nested symbols', () => {
    // Create a script with nested and top-level symbols
    const testScript = `#!/usr/bin/env fish

function top_level_function
    echo "I'm at the top level"
    
    function nested_function
        echo "I'm nested"
    end
    
    set -l function_local "function local"
end

set -g global_var "global value"
set -l script_local "script local"
`;

    // Create and analyze document
    const testDoc = LspDocument.createTextDocumentItem('file:///test.fish', testScript);
    analyzer.analyze(testDoc);

    // Get all symbols from the document
    const allSymbols = Array.from(analyzer.getFlatDocumentSymbols(testDoc.uri));

    // Test top-level function
    const topLevelFunction = allSymbols.find(s => s.name === 'top_level_function');
    expect(topLevelFunction).toBeDefined();
    expect(topLevelFunction!.isRootLevel()).toBe(true);
    expect(topLevelFunction!.parent).toBeUndefined();

    // Test nested function
    const nestedFunction = allSymbols.find(s => s.name === 'nested_function');
    expect(nestedFunction).toBeDefined();
    expect(nestedFunction!.isRootLevel()).toBe(false);
    expect(nestedFunction!.parent).toBeDefined();
    expect(nestedFunction!.parent!.name).toBe('top_level_function');

    // Test global variable
    const globalVar = allSymbols.find(s => s.name === 'global_var');
    expect(globalVar).toBeDefined();
    expect(globalVar!.isRootLevel()).toBe(true);
    expect(globalVar!.parent).toBeUndefined();

    // Test script-local variable
    const scriptLocal = allSymbols.find(s => s.name === 'script_local');
    expect(scriptLocal).toBeDefined();
    expect(scriptLocal!.isRootLevel()).toBe(true);
    expect(scriptLocal!.parent).toBeUndefined();

    // Test function-local variable
    const functionLocal = allSymbols.find(s => s.name === 'function_local');
    expect(functionLocal).toBeDefined();
    expect(functionLocal!.isRootLevel()).toBe(false);
    expect(functionLocal!.parent).toBeDefined();
    expect(functionLocal!.parent!.name).toBe('top_level_function');
  });

  test('should filter symbols correctly in symbolsFromResource', () => {
    // Create a script with both exportable and non-exportable symbols
    const sourceScript = `#!/usr/bin/env fish

function exportable_function
    echo "I should be exported"
    
    function nested_function
        echo "I should NOT be exported"
    end
    
    set -l function_scoped "I should NOT be exported"
end

function another_exportable
    echo "I should also be exported"
end

set -g global_var "I should be exported"
set -l root_local "I should be exported"
`;

    // Create and analyze document
    const sourceDoc = LspDocument.createTextDocumentItem('file:///source.fish', sourceScript);
    analyzer.analyze(sourceDoc);

    // Create a mock SourceResource
    const mockSourceResource = {
      to: sourceDoc,
      from: sourceDoc,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      node: {} as any,
      definitionScope: {} as any,
      sources: [],
    };

    // Get exported symbols using symbolsFromResource
    const exportedSymbols = symbolsFromResource(analyzer, mockSourceResource);
    const exportedNames = exportedSymbols.map(s => s.name);

    // Should export root-level functions
    expect(exportedNames).toContain('exportable_function');
    expect(exportedNames).toContain('another_exportable');

    // Should export root-level variables
    expect(exportedNames).toContain('global_var');
    expect(exportedNames).toContain('root_local');

    // Should NOT export nested functions
    expect(exportedNames).not.toContain('nested_function');

    // Should NOT export function-scoped variables
    expect(exportedNames).not.toContain('function_scoped');

    // Verify all exported symbols are indeed root level
    for (const symbol of exportedSymbols) {
      expect(symbol.isRootLevel()).toBe(true);
    }
  });

  test('should handle deeply nested symbols correctly', () => {
    const deeplyNestedScript = `#!/usr/bin/env fish

function level1
    function level2
        function level3
            echo "deeply nested"
        end
    end
end

function root_level
    echo "at the root"
end
`;

    const doc = LspDocument.createTextDocumentItem('file:///nested.fish', deeplyNestedScript);
    analyzer.analyze(doc);

    const allSymbols = Array.from(analyzer.getFlatDocumentSymbols(doc.uri));

    // Check level1 (root)
    const level1 = allSymbols.find(s => s.name === 'level1');
    expect(level1).toBeDefined();
    expect(level1!.isRootLevel()).toBe(true);
    expect(level1!.parent).toBeUndefined();

    // Check level2 (child of level1)
    const level2 = allSymbols.find(s => s.name === 'level2');
    expect(level2).toBeDefined();
    expect(level2!.isRootLevel()).toBe(false);
    expect(level2!.parent).toBeDefined();
    expect(level2!.parent!.name).toBe('level1');

    // Check level3 (child of level2)
    const level3 = allSymbols.find(s => s.name === 'level3');
    expect(level3).toBeDefined();
    expect(level3!.isRootLevel()).toBe(false);
    expect(level3!.parent).toBeDefined();
    expect(level3!.parent!.name).toBe('level2');

    // Check root_level (root)
    const rootLevel = allSymbols.find(s => s.name === 'root_level');
    expect(rootLevel).toBeDefined();
    expect(rootLevel!.isRootLevel()).toBe(true);
    expect(rootLevel!.parent).toBeUndefined();

    // Test symbolsFromResource with deeply nested structure
    const mockSourceResource = {
      to: doc,
      from: doc,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      node: {} as any,
      definitionScope: {} as any,
      sources: [],
    };

    const exportedSymbols = symbolsFromResource(analyzer, mockSourceResource);
    const exportedNames = exportedSymbols.map(s => s.name);

    // Should only export root-level symbols
    expect(exportedNames).toContain('level1');
    expect(exportedNames).toContain('root_level');
    expect(exportedNames).not.toContain('level2');
    expect(exportedNames).not.toContain('level3');
  });
});
