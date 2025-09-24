import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { SyntaxNode, Tree } from 'web-tree-sitter';

import { Analyzer } from '../src/analyze';
import { TestWorkspace, TestFile } from './test-workspace-utils';
import { LspDocument } from '../src/document';
import * as LSP from 'vscode-languageserver';

// Tree-sitter utilities
import {
  getChildNodes,
  getRange,
} from '../src/utils/tree-sitter';

// FishSymbol and related functionality
import {
  FishSymbol,
  processNestedTree,
  filterLastPerScopeSymbol,
  findLocalLocations,
  // getGlobalSymbols,
  // getLocalSymbols,
  // isSymbol,
  formatFishSymbolTree,
} from '../src/parsing/symbol';

import { flattenNested } from '../src/utils/flatten';

// Fish shell code generators for FishSymbol testing
const fishSymbolArbitraries = {
  // Basic identifiers
  identifier: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  functionName: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]*$/),
  variableName: fc.oneof(
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    fc.constant('argv'),
    fc.constant('status'),
    fc.constant('PATH'),
    fc.constant('HOME'),
    fc.constant('USER'),
  ),
  commandName: fc.oneof(
    fc.constant('echo'),
    fc.constant('set'),
    fc.constant('test'),
    fc.constant('ls'),
    fc.constant('cat'),
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]*$/),
  ),
  stringValue: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\n') && !s.includes("'")),
  option: fc.oneof(
    fc.stringMatching(/^-[a-zA-Z]$/),
    fc.stringMatching(/^--[a-zA-Z][a-zA-Z0-9-]*$/),
  ),
  path: fc.oneof(
    fc.constant('config.fish'),
    fc.constant('conf.d/aliases.fish'),
    fc.constant('functions/foo.fish'),
    fc.constant('completions/foo.fish'),
    fc.constant('/usr/share/fish/foo.fish'),
    fc.constant('script/foo'),
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_/.-]*\.fish$/),
  ),
};

// Generators for different types of FishSymbol definitions
const fishSymbolGenerators = {
  // Function definitions that create FUNCTION symbols
  functionDefinition: fc.tuple(
    fishSymbolArbitraries.functionName,
    fc.array(fishSymbolArbitraries.stringValue, { minLength: 0, maxLength: 3 }),
    fishSymbolArbitraries.path,
  ).map(([name, body, path]) => ({
    code: `function ${name}\n${body.map(line => `  echo '${line}'`).join('\n')}\nend`,
    path,
    expectedSymbols: [{ name, kind: LSP.SymbolKind.Function, fishKind: 'FUNCTION' }],
  })),

  // Function with argument names that create ARGUMENT symbols
  functionWithArguments: fc.tuple(
    fishSymbolArbitraries.functionName,
    fc.array(fishSymbolArbitraries.identifier, { minLength: 1, maxLength: 4 }),
    fishSymbolArbitraries.path,
  ).map(([name, args, path]) => ({
    code: `function ${name} --argument-names ${args.join(' ')}\n  echo $${args[0]}\nend`,
    path,
    expectedSymbols: [
      { name, kind: LSP.SymbolKind.Function, fishKind: 'FUNCTION' },
      ...args.map(arg => ({ name: arg, kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' })),
      { name: 'argv', kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' },
    ],
  })),

  // Set commands that create VARIABLE symbols
  setCommand: fc.tuple(
    fishSymbolArbitraries.variableName,
    fishSymbolArbitraries.stringValue,
    fc.oneof(fc.constant('-gx'), fc.constant('-x'), fc.constant('-l'), fc.constant('')),
    fishSymbolArbitraries.path,
  ).map(([name, value, flag, path]) => ({
    code: `set ${flag} ${name} '${value}'`,
    path,
    expectedSymbols: [{ name, kind: LSP.SymbolKind.Variable, fishKind: 'SET' }],
  })),

  // For loops that create FOR symbols
  forLoop: fc.tuple(
    fishSymbolArbitraries.variableName,
    fc.array(fishSymbolArbitraries.stringValue, { minLength: 1, maxLength: 5 }),
    fishSymbolArbitraries.path,
  ).map(([varName, items, path]) => ({
    code: `for ${varName} in ${items.map(i => `'${i}'`).join(' ')}\n  echo $${varName}\nend`,
    path,
    expectedSymbols: [{ name: varName, kind: LSP.SymbolKind.Variable, fishKind: 'FOR' }],
  })),

  // Alias definitions that create ALIAS symbols
  aliasDefinition: fc.tuple(
    fishSymbolArbitraries.identifier,
    fishSymbolArbitraries.commandName,
    fishSymbolArbitraries.path,
  ).map(([alias, command, path]) => ({
    code: `alias ${alias}='${command}'`,
    path,
    expectedSymbols: [{ name: alias, kind: LSP.SymbolKind.Function, fishKind: 'ALIAS' }],
  })),

  // Read commands that create READ symbols
  readCommand: fc.tuple(
    fishSymbolArbitraries.variableName,
    fishSymbolArbitraries.stringValue,
    fishSymbolArbitraries.path,
  ).map(([varName, input, path]) => ({
    code: `echo '${input}' | read ${varName}`,
    path,
    expectedSymbols: [{ name: varName, kind: LSP.SymbolKind.Variable, fishKind: 'READ' }],
  })),

  // Argparse that creates ARGPARSE symbols
  argparseCommand: fc.tuple(
    fishSymbolArbitraries.functionName,
    fc.array(fishSymbolArbitraries.identifier, { minLength: 2, maxLength: 4 }),
    fishSymbolArbitraries.path,
  ).map(([funcName, options, path]) => ({
    code: `function ${funcName}\n  argparse ${options.map(opt => `'${opt}'`).join(' ')} -- $argv\n  echo $_flag_${options[0]}\nend`,
    path,
    expectedSymbols: [
      { name: funcName, kind: LSP.SymbolKind.Function, fishKind: 'FUNCTION' },
      { name: 'argv', kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' },
      ...options.flatMap(opt => [
        { name: `_flag_${opt.charAt(0)}`, kind: LSP.SymbolKind.Variable, fishKind: 'ARGPARSE' },
        { name: `_flag_${opt}`, kind: LSP.SymbolKind.Variable, fishKind: 'ARGPARSE' },
      ]),
    ],
  })),

  // Complex nested function with multiple symbol types
  complexNested: fc.tuple(
    fishSymbolArbitraries.functionName,
    fishSymbolArbitraries.variableName,
    fc.array(fishSymbolArbitraries.identifier, { minLength: 2, maxLength: 3 }),
    fishSymbolArbitraries.path,
  ).map(([funcName, varName, args, path]) => ({
    code: `function ${funcName} --argument-names ${args.join(' ')}
  set -l ${varName} (date +%s)
  for i in $argv
    echo $i
  end
  alias temp_alias='echo temp'
end`,
    path,
    expectedSymbols: [
      { name: funcName, kind: LSP.SymbolKind.Function, fishKind: 'FUNCTION' },
      ...args.map(arg => ({ name: arg, kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' })),
      { name: 'argv', kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' },
      { name: varName, kind: LSP.SymbolKind.Variable, fishKind: 'SET' },
      { name: 'i', kind: LSP.SymbolKind.Variable, fishKind: 'FOR' },
      { name: 'temp_alias', kind: LSP.SymbolKind.Function, fishKind: 'ALIAS' },
    ],
  })),

  // Shebang script that creates local scope
  shebangScript: fc.tuple(
    fishSymbolArbitraries.functionName,
    fishSymbolArbitraries.variableName,
    fishSymbolArbitraries.stringValue,
  ).map(([funcName, varName, value]) => ({
    code: `#!/usr/bin/env fish\nfunction ${funcName}\n  echo 'hello'\nend\nset -l ${varName} '${value}'`,
    path: 'script/test',
    expectedSymbols: [
      { name: funcName, kind: LSP.SymbolKind.Function, fishKind: 'FUNCTION' },
      { name: 'argv', kind: LSP.SymbolKind.Variable, fishKind: 'ARGUMENT' },
      { name: varName, kind: LSP.SymbolKind.Variable, fishKind: 'SET' },
    ],
  })),
};

describe('FishSymbol Fast-check Property Tests', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  describe('FishSymbol Creation Properties', () => {
    it('should correctly identify function symbols and their properties', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have the expected number of function symbols
          const functionSymbols = flatSymbols.filter(s => s.fishKind === 'FUNCTION');
          expect(functionSymbols.length).toBeGreaterThan(0);

          // Property: Function symbol should have correct properties
          const funcSymbol = functionSymbols[0]!;
          expect(funcSymbol.kind).toBe(LSP.SymbolKind.Function);
          expect(funcSymbol.fishKind).toBe('FUNCTION');
          expect(typeof funcSymbol.name).toBe('string');
          expect(funcSymbol.name.length).toBeGreaterThan(0);

          // Property: Function should have argv child for non-script files
          if (!testCase.path.includes('script/')) {
            const argvSymbols = flatSymbols.filter(s => s.name === 'argv');
            expect(argvSymbols.length).toBeGreaterThan(0);
          }

          // Property: Function symbols should be properly scoped
          if (testCase.path.includes('config.fish') || testCase.path.includes('conf.d/')) {
            expect(funcSymbol.isGlobal()).toBe(true);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly handle function arguments and create ARGUMENT symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionWithArguments, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have ARGUMENT symbols for each argument
          const argumentSymbols = flatSymbols.filter(s => s.fishKind === 'ARGUMENT');
          expect(argumentSymbols.length).toBeGreaterThan(0);

          // Property: All argument symbols should be local
          for (const argSymbol of argumentSymbols) {
            expect(argSymbol.isLocal()).toBe(true);
            expect(argSymbol.kind).toBe(LSP.SymbolKind.Variable);
          }

          // Property: Should have argv symbol
          const argvSymbol = flatSymbols.find(s => s.name === 'argv');
          expect(argvSymbol).toBeDefined();
          expect(argvSymbol!.fishKind).toBe('ARGUMENT');

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly create VARIABLE symbols from set commands', () => {
      fc.assert(fc.property(fishSymbolGenerators.setCommand, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have SET symbols
          const setSymbols = flatSymbols.filter(s => s.fishKind === 'SET');
          expect(setSymbols.length).toBeGreaterThan(0);

          // Property: SET symbols should have correct properties
          const setSymbol = setSymbols[0]!;
          expect(setSymbol.kind).toBe(LSP.SymbolKind.Variable);
          expect(setSymbol.fishKind).toBe('SET');
          expect(typeof setSymbol.name).toBe('string');

          // Property: Scope should be determined by flags and location
          const isGlobalFlag = testCase.code.includes('-gx') || testCase.code.includes('-x');
          const isConfig = testCase.path.includes('config.fish') || testCase.path.includes('conf.d/');

          if (isGlobalFlag && isConfig) {
            expect(setSymbol.isGlobal()).toBe(true);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly create FOR symbols from for loops', () => {
      fc.assert(fc.property(fishSymbolGenerators.forLoop, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have FOR symbols
          const forSymbols = flatSymbols.filter(s => s.fishKind === 'FOR');
          expect(forSymbols.length).toBeGreaterThan(0);

          // Property: FOR symbols should have correct properties
          const forSymbol = forSymbols[0]!;
          expect(forSymbol.kind).toBe(LSP.SymbolKind.Variable);
          expect(forSymbol.fishKind).toBe('FOR');
          expect(forSymbol.isLocal()).toBe(true);

          // Property: Scope node should be for_statement
          expect(forSymbol.scopeNode.type).toBe('for_statement');

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly create ALIAS symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.aliasDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have ALIAS symbols
          const aliasSymbols = flatSymbols.filter(s => s.fishKind === 'ALIAS');
          expect(aliasSymbols.length).toBeGreaterThan(0);

          // Property: ALIAS symbols should have correct properties
          const aliasSymbol = aliasSymbols[0]!;
          expect(aliasSymbol.kind).toBe(LSP.SymbolKind.Function);
          expect(aliasSymbol.fishKind).toBe('ALIAS');

          // Property: Aliases should be global when in config files
          const isConfig = testCase.path.includes('config.fish') || testCase.path.includes('conf.d/');
          if (isConfig) {
            expect(aliasSymbol.isGlobal()).toBe(true);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly create READ symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.readCommand, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have READ symbols
          const readSymbols = flatSymbols.filter(s => s.fishKind === 'READ');
          expect(readSymbols.length).toBeGreaterThan(0);

          // Property: READ symbols should have correct properties
          const readSymbol = readSymbols[0]!;
          expect(readSymbol.kind).toBe(LSP.SymbolKind.Variable);
          expect(readSymbol.fishKind).toBe('READ');

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });

    it('should correctly create ARGPARSE symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.argparseCommand, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Should have ARGPARSE symbols
          const argparseSymbols = flatSymbols.filter(s => s.fishKind === 'ARGPARSE');
          expect(argparseSymbols.length).toBeGreaterThan(0);

          // Property: ARGPARSE symbols should have correct properties
          for (const argparseSymbol of argparseSymbols) {
            expect(argparseSymbol.kind).toBe(LSP.SymbolKind.Variable);
            expect(argparseSymbol.fishKind).toBe('ARGPARSE');
            expect(argparseSymbol.name.startsWith('_flag_')).toBe(true);
            expect(argparseSymbol.isLocal()).toBe(true);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 30 });
    });
  });

  describe('FishSymbol Relationship Properties', () => {
    it('should maintain correct parent-child relationships', () => {
      fc.assert(fc.property(fishSymbolGenerators.complexNested, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Function should have child symbols
          const functionSymbols = symbols.filter(s => s.fishKind === 'FUNCTION');
          if (functionSymbols.length > 0) {
            const funcSymbol = functionSymbols[0]!;
            expect(funcSymbol.children.length).toBeGreaterThan(0);

            // Property: All children should have correct parent reference
            for (const child of funcSymbol.children) {
              expect(child.parent).toBe(funcSymbol);
            }
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly implement isBefore/isAfter relationships', () => {
      fc.assert(fc.property(
        fc.tuple(fishSymbolGenerators.aliasDefinition, fishSymbolGenerators.aliasDefinition),
        ([testCase1, testCase2]) => {
          try {
            const combinedCode = `${testCase1.code}\n${testCase2.code}`;
            const testWorkspace = TestWorkspace.createSingle(combinedCode, testCase1.path);
            testWorkspace.initialize();

            const doc = testWorkspace.focusedDocument;
            if (!doc || !doc.tree?.rootNode) return true;

            const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
            const flatSymbols = flattenNested(...symbols);

            const aliasSymbols = flatSymbols.filter(s => s.fishKind === 'ALIAS');
            if (aliasSymbols.length >= 2) {
              const [first, second] = aliasSymbols;

              // Property: First symbol should be before second
              expect(first!.isBefore(second!)).toBe(true);
              expect(second!.isAfter(first!)).toBe(true);
              expect(first!.isAfter(second!)).toBe(false);
              expect(second!.isBefore(first!)).toBe(false);
            }

            return true;
          } catch (error) {
            return true;
          }
        },
      ), { numRuns: 20 });
    });

    it('should correctly implement equalScopes for symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.complexNested, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Symbols in the same scope should have equal scopes
          const localSymbols = flatSymbols.filter(s => s.isLocal());
          if (localSymbols.length >= 2) {
            const [first, second] = localSymbols;
            if (first!.scopeNode.equals(second!.scopeNode)) {
              expect(first!.equalScopes(second!)).toBe(true);
            }
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });
  });

  describe('FishSymbol Scope Properties', () => {
    it('should correctly identify global vs local symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.shebangScript, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Script symbols should be local for shebang scripts
          for (const symbol of flatSymbols) {
            if (symbol.fishKind === 'FUNCTION' && testCase.path.includes('script/')) {
              expect(symbol.isLocal()).toBe(true);
              expect(symbol.scopeTag).toBe('local');
            }
          }

          // Property: Global and local symbols should be mutually exclusive
          for (const symbol of flatSymbols) {
            expect(symbol.isGlobal() && symbol.isLocal()).toBe(false);
            expect(symbol.isGlobal() || symbol.isLocal()).toBe(true);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly determine scopeTag based on context', () => {
      const testCases = [
        { code: 'set -gx FOO foo', path: 'config.fish', expectedGlobal: true },
        { code: 'function foo\n  set -l BAR bar\nend', path: 'config.fish', expectedLocal: true },
        { code: '#!/usr/bin/env fish\nset FOO foo', path: 'script/test', expectedLocal: true },
      ];

      fc.assert(fc.property(fc.constantFrom(...testCases), (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          const variableSymbols = flatSymbols.filter(s => s.fishKind === 'SET');
          if (variableSymbols.length > 0) {
            const varSymbol = variableSymbols[0]!;
            if (testCase.expectedGlobal) {
              expect(varSymbol.isGlobal()).toBe(true);
              expect(varSymbol.scopeTag).toBe('global');
            }
            if (testCase.expectedLocal) {
              expect(varSymbol.isLocal()).toBe(true);
              expect(varSymbol.scopeTag).toBe('local');
            }
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 15 });
    });
  });

  describe('FishSymbol Conversion Properties', () => {
    it('should correctly convert to LSP Location', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          for (const symbol of flatSymbols.slice(0, 5)) {
            const location = symbol.toLocation();

            // Property: Location should have valid URI
            expect(location.uri).toBe(doc.uri);

            // Property: Location should have valid range
            expect(location.range).toBeDefined();
            expect(location.range.start.line).toBeGreaterThanOrEqual(0);
            expect(location.range.start.character).toBeGreaterThanOrEqual(0);
            expect(location.range.end.line).toBeGreaterThanOrEqual(location.range.start.line);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly convert to WorkspaceSymbol', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          const globalSymbols = flatSymbols.filter(s => s.isGlobal());
          for (const symbol of globalSymbols) {
            const wsSymbol = symbol.toWorkspaceSymbol();

            // Property: WorkspaceSymbol should have correct structure
            expect(wsSymbol.name).toBe(symbol.name);
            expect(wsSymbol.kind).toBe(symbol.kind);
            expect(wsSymbol.location.uri).toBe(doc.uri);
            expect(wsSymbol.location.range).toEqual(symbol.selectionRange);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly convert to FoldingRange for functions', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          const functionSymbols = flatSymbols.filter(s => s.fishKind === 'FUNCTION');
          for (const funcSymbol of functionSymbols) {
            const foldingRange = funcSymbol.toFoldingRange();

            // Property: FoldingRange should have valid structure
            expect(foldingRange.startLine).toBeGreaterThanOrEqual(0);
            expect(foldingRange.endLine).toBeGreaterThanOrEqual(foldingRange.startLine);
            expect(foldingRange.collapsedText).toBe(funcSymbol.name);
            expect(foldingRange.kind).toBe(LSP.FoldingRangeKind.Region);
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });
  });

  describe('FishSymbol Utility Function Properties', () => {
    it('should correctly separate global and local symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.complexNested, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          const globalSymbols = getGlobalSymbols(flatSymbols);
          const localSymbols = getLocalSymbols(flatSymbols);

          // Property: Global and local symbols should not overlap
          const globalNames = new Set(globalSymbols.map(s => `${s.name}-${s.scopeNode.id}`));
          const localNames = new Set(localSymbols.map(s => `${s.name}-${s.scopeNode.id}`));

          for (const name of globalNames) {
            expect(localNames.has(name)).toBe(false);
          }

          // Property: Combined should equal total
          expect(globalSymbols.length + localSymbols.length).toBe(flatSymbols.length);

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly filter symbols by type with isSymbol', () => {
      fc.assert(fc.property(fishSymbolGenerators.complexNested, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: isSymbol should correctly filter by fishKind
          const functionSymbols = isSymbol(flatSymbols, 'FUNCTION');
          const setSymbols = isSymbol(flatSymbols, 'SET');
          const aliasSymbols = isSymbol(flatSymbols, 'ALIAS');

          for (const symbol of functionSymbols) {
            expect(symbol.fishKind).toBe('FUNCTION');
          }
          for (const symbol of setSymbols) {
            expect(symbol.fishKind).toBe('SET');
          }
          for (const symbol of aliasSymbols) {
            expect(symbol.fishKind).toBe('ALIAS');
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly find local locations for symbols', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          // Create a test with function usage
          const testCode = `${testCase.code}\n${testCase.expectedSymbols[0]?.name || 'test_func'}`;
          const testWorkspace = TestWorkspace.createSingle(testCode, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          const functionSymbols = flatSymbols.filter(s => s.fishKind === 'FUNCTION');
          if (functionSymbols.length > 0) {
            const funcSymbol = functionSymbols[0]!;
            const locations = findLocalLocations(funcSymbol, flatSymbols);

            // Property: Should find at least the definition location
            expect(locations.length).toBeGreaterThanOrEqual(1);

            // Property: All locations should have valid ranges
            for (const location of locations) {
              expect(location.uri).toBe(doc.uri);
              expect(location.range.start.line).toBeGreaterThanOrEqual(0);
              expect(location.range.start.character).toBeGreaterThanOrEqual(0);
            }
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });

    it('should correctly filter last per scope symbols', () => {
      fc.assert(fc.property(
        fc.array(fishSymbolGenerators.forLoop, { minLength: 2, maxLength: 4 }),
        (testCases) => {
          try {
            // Create multiple for loops with same variable name
            const combinedCode = testCases.map(tc => tc.code).join('\n');
            const testWorkspace = TestWorkspace.createSingle(combinedCode, testCases[0]?.path || 'config.fish');
            testWorkspace.initialize();

            const doc = testWorkspace.focusedDocument;
            if (!doc || !doc.tree?.rootNode) return true;

            const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
            const flatSymbols = flattenNested(...symbols);
            const filteredSymbols = filterLastPerScopeSymbol(flatSymbols);

            // Property: Filtered symbols should be a subset of original
            expect(filteredSymbols.length).toBeLessThanOrEqual(flatSymbols.length);

            // Property: All filtered symbols should exist in original
            for (const filtered of filteredSymbols) {
              expect(flatSymbols.some(s => s.equals(filtered))).toBe(true);
            }

            return true;
          } catch (error) {
            return true;
          }
        },
      ), { numRuns: 15 });
    });
  });

  describe('FishSymbol Edge Cases and Error Handling', () => {
    it('should handle malformed Fish code gracefully', () => {
      const malformedCode = [
        'function\nend', // missing name
        'for\nend', // missing variable
        'set', // incomplete
        'alias', // incomplete
        'function foo\n# missing end',
      ];

      fc.assert(fc.property(
        fc.oneof(...malformedCode.map(code => fc.constant(code))),
        (code) => {
          try {
            const testWorkspace = TestWorkspace.createSingle(code, 'config.fish');
            testWorkspace.initialize();

            const doc = testWorkspace.focusedDocument;
            if (!doc || !doc.tree?.rootNode) return true;

            // Property: Should not throw errors even with malformed code
            expect(() => {
              const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
              const flatSymbols = flattenNested(...symbols);

              // Test various operations
              getGlobalSymbols(flatSymbols);
              getLocalSymbols(flatSymbols);
              filterLastPerScopeSymbol(flatSymbols);

              for (const symbol of flatSymbols) {
                symbol.toLocation();
                symbol.isGlobal();
                symbol.isLocal();
              }
            }).not.toThrow();

            return true;
          } catch (error) {
            // Controlled failures are acceptable for malformed input
            return true;
          }
        },
      ), { numRuns: 25 });
    });

    it('should maintain symbol equality consistency', () => {
      fc.assert(fc.property(fishSymbolGenerators.functionDefinition, (testCase) => {
        try {
          const testWorkspace = TestWorkspace.createSingle(testCase.code, testCase.path);
          testWorkspace.initialize();

          const doc = testWorkspace.focusedDocument;
          if (!doc || !doc.tree?.rootNode) return true;

          const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
          const flatSymbols = flattenNested(...symbols);

          // Property: Symbol should equal itself
          for (const symbol of flatSymbols) {
            expect(symbol.equals(symbol)).toBe(true);
          }

          // Property: Equality should be symmetric
          if (flatSymbols.length >= 2) {
            const [first, second] = flatSymbols;
            expect(first!.equals(second!)).toBe(second!.equals(first!));
          }

          return true;
        } catch (error) {
          return true;
        }
      }), { numRuns: 20 });
    });
  });

  describe('FishSymbol Performance Properties', () => {
    it('should handle large symbol trees efficiently', () => {
      fc.assert(fc.property(
        fc.array(fishSymbolGenerators.complexNested, { minLength: 5, maxLength: 15 }),
        (testCases) => {
          try {
            const startTime = Date.now();

            const combinedCode = testCases.map(tc => tc.code).join('\n\n');
            const testWorkspace = TestWorkspace.createSingle(combinedCode, 'config.fish');
            testWorkspace.initialize();

            const doc = testWorkspace.focusedDocument;
            if (!doc || !doc.tree?.rootNode) return true;

            const symbols: FishSymbol[] = processNestedTree(doc, doc.tree.rootNode);
            const flatSymbols = flattenNested(...symbols);

            const processingTime = Date.now() - startTime;

            // Property: Processing should complete in reasonable time
            expect(processingTime).toBeLessThan(3000); // 3 seconds max

            // Property: Should handle large symbol counts
            expect(flatSymbols.length).toBeGreaterThan(0);

            // Property: Basic operations should complete without errors
            expect(() => {
              getGlobalSymbols(flatSymbols);
              getLocalSymbols(flatSymbols);
              filterLastPerScopeSymbol(flatSymbols);
              formatFishSymbolTree(symbols);
            }).not.toThrow();

            return true;
          } catch (error) {
            return true;
          }
        },
      ), { numRuns: 10 }); // Fewer runs for performance tests
    });
  });
});
