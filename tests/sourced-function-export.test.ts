import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import * as Parser from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import { initializeParser } from '../src/parser';
import { createSourceResources, SourceResource, symbolsFromResource } from '../src/parsing/source';
import { FishSymbol } from '../src/parsing/symbol';
import { createFakeLspDocument, setLogger } from './helpers';
import { workspaceManager } from '../src/utils/workspace-manager';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Sourced Function Export', () => {
  let parser: Parser;

  setLogger();

  beforeEach(async () => {
    setupProcessEnvExecFile();
    parser = await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  afterEach(() => {
    parser.delete();
    workspaceManager.clear();
  });

  test('should handle real script files with sourcing', () => {
    // Read the actual files from the repository
    const continueOrExitPath = resolve(__dirname, '../scripts/continue_or_exit.fish');
    const prettyPrintPath = resolve(__dirname, '../scripts/pretty-print.fish');
    const publishNightlyPath = resolve(__dirname, '../scripts/publish-nightly.fish');

    const continueOrExitContent = readFileSync(continueOrExitPath, 'utf8');
    const prettyPrintContent = readFileSync(prettyPrintPath, 'utf8');
    const publishNightlyContent = readFileSync(publishNightlyPath, 'utf8');

    // Create documents using the real file content
    const continueOrExitDoc = createFakeLspDocument('scripts/continue_or_exit.fish', continueOrExitContent);
    const prettyPrintDoc = createFakeLspDocument('scripts/pretty-print.fish', prettyPrintContent);
    const publishNightlyDoc = createFakeLspDocument('scripts/publish-nightly.fish', publishNightlyContent);

    // Analyze all documents
    analyzer.analyze(continueOrExitDoc);
    analyzer.analyze(prettyPrintDoc);
    analyzer.analyze(publishNightlyDoc);

    // Test continue_or_exit.fish symbols
    const continueOrExitSymbols = Array.from(analyzer.getFlatDocumentSymbols(continueOrExitDoc.uri));
    
    // Should have the main function
    const continueOrExitFunction = continueOrExitSymbols.find(s => s.name === 'continue_or_exit');
    expect(continueOrExitFunction).toBeDefined();
    expect(continueOrExitFunction!.isFunction()).toBe(true);
    expect(continueOrExitFunction!.isRootLevel()).toBe(true);
    expect(continueOrExitFunction!.parent).toBeUndefined();

    // Should have the helper function
    const printTextFunction = continueOrExitSymbols.find(s => s.name === 'print_text_with_color');
    expect(printTextFunction).toBeDefined();
    expect(printTextFunction!.isFunction()).toBe(true);
    expect(printTextFunction!.isRootLevel()).toBe(true);
    expect(printTextFunction!.parent).toBeUndefined();

    // Test pretty-print.fish symbols
    const prettyPrintSymbols = Array.from(analyzer.getFlatDocumentSymbols(prettyPrintDoc.uri));
    
    // Should have global color variables
    const greenVar = prettyPrintSymbols.find(s => s.name === 'GREEN');
    expect(greenVar).toBeDefined();
    expect(greenVar!.isVariable()).toBe(true);
    expect(greenVar!.isRootLevel()).toBe(true);
    expect(greenVar!.parent).toBeUndefined();

    // Should have utility functions
    const resetColorFunction = prettyPrintSymbols.find(s => s.name === 'reset_color');
    expect(resetColorFunction).toBeDefined();
    expect(resetColorFunction!.isFunction()).toBe(true);
    expect(resetColorFunction!.isRootLevel()).toBe(true);

    // Test symbolic linking with mock resources
    const mockContinueOrExitResource = {
      to: continueOrExitDoc,
      from: publishNightlyDoc,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      node: {} as any,
      definitionScope: {} as any,
      sources: []
    } as unknown as SourceResource;

    const mockPrettyPrintResource = {
      to: prettyPrintDoc,
      from: publishNightlyDoc,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      node: {} as any,
      definitionScope: {} as any,
      sources: []
    } as unknown as SourceResource; 

    // Test symbolsFromResource with continue_or_exit.fish
    const exportedContinueOrExitSymbols = symbolsFromResource(analyzer, mockContinueOrExitResource);
    const exportedContinueOrExitNames = exportedContinueOrExitSymbols.map(s => s.name);

    expect(exportedContinueOrExitNames).toContain('continue_or_exit');
    expect(exportedContinueOrExitNames).toContain('print_text_with_color');

    // Test symbolsFromResource with pretty-print.fish
    const exportedPrettyPrintSymbols = symbolsFromResource(analyzer, mockPrettyPrintResource);
    const exportedPrettyPrintNames = exportedPrettyPrintSymbols.map(s => s.name);

    expect(exportedPrettyPrintNames).toContain('GREEN');
    expect(exportedPrettyPrintNames).toContain('RED');
    expect(exportedPrettyPrintNames).toContain('BLUE');
    expect(exportedPrettyPrintNames).toContain('reset_color');
    expect(exportedPrettyPrintNames).toContain('print_success');
    expect(exportedPrettyPrintNames).toContain('print_failure');

    // Verify exported symbols are either root level OR global
    const allExportedSymbols = [...exportedContinueOrExitSymbols, ...exportedPrettyPrintSymbols];
    
    // The symbolsFromResource function should return symbols that are either:
    // 1. Root level (no parent), OR
    // 2. Global variables (accessible globally even if defined in functions)
    for (const symbol of allExportedSymbols) {
      const isValidExport = symbol.isRootLevel() || symbol.isGlobal();
      if (!isValidExport) {
        console.log(`Invalid export: ${symbol.name} (${symbol.fishKind}) - Parent: ${symbol.parent?.name}, Global: ${symbol.isGlobal()}, RootLevel: ${symbol.isRootLevel()}`);
      }
      expect(isValidExport).toBe(true);
    }
    
    // Specifically check that CONTINUE_OR_EXIT_ANSWER is included as a global variable
    const continueOrExitAnswer = allExportedSymbols.find(s => s.name === 'CONTINUE_OR_EXIT_ANSWER');
    expect(continueOrExitAnswer).toBeDefined();
    expect(continueOrExitAnswer!.isGlobal()).toBe(true);
    expect(continueOrExitAnswer!.isRootLevel()).toBe(false); // It has a parent function
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
    const testDoc = createFakeLspDocument('test.fish', testScript);
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

    // Test symbolsFromResource filtering
    const mockSourceResource = {
      to: testDoc,
      from: testDoc,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      node: {} as any,
      definitionScope: {} as any,
      sources: []
    };

    const exportedSymbols = symbolsFromResource(analyzer, mockSourceResource);
    const exportedNames = exportedSymbols.map(s => s.name);

    // Should export top-level symbols
    expect(exportedNames).toContain('top_level_function');
    expect(exportedNames).toContain('global_var');
    expect(exportedNames).toContain('script_local');

    // Should NOT export nested symbols
    expect(exportedNames).not.toContain('nested_function');
    expect(exportedNames).not.toContain('function_local');
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

    const doc = createFakeLspDocument('nested.fish', deeplyNestedScript);
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
      sources: []
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
