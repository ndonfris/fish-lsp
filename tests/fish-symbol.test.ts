import * as os from 'os';
import { filterLastPerScopeSymbol, findLocalLocations, FishSymbol, processNestedTree } from '../src/parsing/symbol';
import * as LSP from 'vscode-languageserver';
import { setLogger, setupTestCallback, getAllTypesOfNestedArrays } from './helpers';
import { initializeParser } from '../src/parser';
import { flattenNested } from '../src/utils/flatten';
// import { LspDocument } from '../src/document';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { config } from '../src/config';

let parser: Parser;
let testBuilder: ReturnType<typeof setupTestCallback>;

function getGlobalSymbols(symbols: FishSymbol[]): FishSymbol[] {
  return symbols.filter(s => s.isGlobal());
}

function getLocalSymbols(symbols: FishSymbol[]): FishSymbol[] {
  return symbols.filter(s => s.isLocal());
}

describe('`./src/parsing/**.ts` tests', () => {
  beforeAll(async () => {
    parser = await initializeParser();
  });
  beforeEach(() => {
    parser.reset();
    testBuilder = setupTestCallback(parser);
  });
  setLogger();

  describe('building `FishSymbol[]`', () => {
    it('`config.fish` w/ `foo` function', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        "  echo 'hello'",
        'end',
      );
      const nodes: SyntaxNode[] = flattenNested(root);
      expect(nodes.length).toBeGreaterThan(4);

      expect(doc.uri.endsWith('.config/fish/config.fish')).toBeTruthy();

      const symbols: FishSymbol[] = processNestedTree(doc, root);
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe('foo');

      const flatSymbols = flattenNested(...symbols);
      expect(flatSymbols).toHaveLength(2);
      expect(flatSymbols[0]!.name).toBe('foo');
      expect(flatSymbols[1]!.name).toBe('argv');
    });

    it('`config.fish` w/ `foo` function and `bar` function', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        "  echo 'hello'",
        'end',
        'function bar',
        "  echo 'world'",
        'end',
      );
      expect(doc.isAutoloaded()).toBeTruthy();

      const symbols: FishSymbol[] = processNestedTree(doc, root);
      expect(symbols).toHaveLength(2);
      expect(symbols[0]!.name).toBe('foo');
      expect(symbols[1]!.name).toBe('bar');

      const flatSymbols = flattenNested(...symbols);
      expect(flatSymbols).toHaveLength(4);
      expect(flatSymbols[0]!.name).toBe('foo');
      expect(flatSymbols[1]!.name).toBe('bar');
      expect(flatSymbols[2]!.name).toBe('argv');
      expect(flatSymbols[3]!.name).toBe('argv');
    });

    it('`conf.d/foo.fish`', () => {
      const { doc, root } = testBuilder('conf.d/foo.fish',
        'function _foo_1',
        "  echo 'hello'",
        'end',
        'function _foo_2',
        "  echo 'world'",
        'end',
        'function _foo',
        '  _foo_1 && _foo_2',
        'end',
        'set -gx FOO (_foo)',
      );
      const symbols: FishSymbol[] = processNestedTree(doc, root);
      expect(symbols).toHaveLength(4);
      expect(symbols.map(s => s!.name)).toEqual(['_foo_1', '_foo_2', '_foo', 'FOO']);
      const flatSymbols = flattenNested(...symbols);
      expect(flatSymbols).toHaveLength(7);
      expect(flatSymbols.filter(s => s.name === 'argv')).toHaveLength(3);
      expect(flatSymbols.filter(s => s.kind === LSP.SymbolKind.Variable)).toHaveLength(4);
      expect(flatSymbols.filter(s => s.isGlobal())).toHaveLength(4);
      expect(flatSymbols.filter(s => s.isLocal())).toHaveLength(3);
    });

    it('`script/shebang/foo`', () => {
      const { doc, root } = testBuilder('script/shebang/foo',
        '#!/usr/bin/env fish',
        'function foo',
        "  echo 'hello'",
        'end',
        'foo $argv',
      );
      const { symbols, flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(symbols).toHaveLength(2);
      expect(flatSymbols).toHaveLength(3);
      expect(flatSymbols.filter(s => s.isGlobal())).toHaveLength(0);
    });

    it('`config.fish` w/ more variable definitions', () => {
      const { doc, root } = testBuilder('config.fish',
        'set -gx FOO foo',
        'set -gx BAR bar',
        "echo 'baz' | read BAZ",
        'function _my_func --argument-names first second third',
        '  echo $first',
        '  echo $second',
        '  echo $third',
        '  for arg in $argv',
        '    echo $arg',
        '  end',
        'end',
      );
      const { symbols, flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const variableSymbols = flatSymbols.filter(s => s.kind === LSP.SymbolKind.Variable);
      expect(symbols).toHaveLength(4);
      expect(variableSymbols).toHaveLength(8);
      expect(variableSymbols.filter(s => s.isGlobal())).toHaveLength(3);
      expect(variableSymbols.filter(s => s.isGlobal()).map(s => s.name)).toEqual(['FOO', 'BAR', 'BAZ']);
      expect(flatSymbols.filter(s => s.isLocal())).toHaveLength(5);
    });

    it('`functions/foo.fish` w/ argparse', () => {
      const { doc, root } = testBuilder('functions/foo.fish',
        'function foo',
        '  argparse --stop-nonopt f/first s/second -- $argv',
        '  or return',
        '  echo $_flag_first',
        '  echo $_flag_second',
        'end',
      );
      const { symbols, flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(symbols).toHaveLength(1);
      expect(flatSymbols.filter(s => s.fishKind === 'ARGPARSE')).toHaveLength(4);
      expect(flatSymbols.filter(s => s.fishKind === 'ARGPARSE').map(s => s.name)).toEqual(['_flag_f', '_flag_first', '_flag_s', '_flag_second']);
    });
    it('`conf.d/aliases.fish`', () => {
      const { doc, root } = testBuilder('conf.d/aliases.fish',
        "alias foo='echo foo'",
        "alias bar='echo bar'",
      );
      const { symbols, flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(symbols).toHaveLength(2);
      expect(flatSymbols).toHaveLength(2);
      expect(flatSymbols.filter(s => s.fishKind === 'ALIAS')).toHaveLength(2);
      expect(flatSymbols.filter(s => s.fishKind === 'ALIAS').map(s => s.name)).toEqual(['foo', 'bar']);
      expect(flatSymbols.filter(s => s.isGlobal())).toHaveLength(2);
    });
  });

  describe('logging client tree', () => {
    function clientTree(symbol: FishSymbol[]) {
      function buildClientTree(indent: string = '', ...symbol: FishSymbol[]): string[] {
        const tree: string[] = [];
        for (const sym of symbol) {
          tree.push(`${indent}${sym.name}`);
          if (sym.children.length > 0) {
            tree.push(...buildClientTree(indent + '  ', ...sym.children));
          }
        }
        return tree;
      }
      return buildClientTree('', ...symbol).join('\n');
    }
    type NestedStringArray = Array<string | NestedStringArray>;
    function expectedClientTree(names: NestedStringArray[]): string {
      function flattenNestedArrayToString(arr: NestedStringArray, indent = 0): string {
        return arr
          .map(item => {
            if (typeof item === 'string') {
              return ' '.repeat(indent * 2) + item;
            } else if (Array.isArray(item)) {
              return flattenNestedArrayToString(item, indent + 1);
            }
            return '';
          })
          .join('\n');
      }

      return names
        .map(item => flattenNestedArrayToString(item))
        .join('\n');
    }

    it('config.fish client tree', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        "  echo 'hello'",
        'end',
        'function bar',
        "  echo 'world'",
        'end',
      );
      const symbols: FishSymbol[] = processNestedTree(doc, root);
      const tree = clientTree(symbols);
      expect(tree).toBe(expectedClientTree([['foo', ['argv']], ['bar', ['argv']]]));
    });

    it.skip('`config.fish` w/ duplicate definitions', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        '  set -l idx 1',
        '  for i in (seq 1 10)',
        '    echo $i',
        '    set idx (math $idx + 1)',
        '  end',
        'end',
      );
      const { symbols, flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(symbols).toBeDefined();
      expect(flatSymbols).toBeDefined();
    });
  });

  // describe('detail `FishSymbol[]`', () => {
  //   it.skip('function definition detail', () => {
  //   });
  //
  //   it.skip('variable definition detail', () => {
  //   });
  //
  //   it.skip('argument definition detail', () => {
  //   });
  //
  //   it.skip('alias definition detail', () => {
  //   });
  // });

  describe('`FishSymbol` properties', () => {
    it('`FishSymbol.isGlobal()`', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        "  echo 'hello'",
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(flatSymbols.filter(s => s.isGlobal())).toHaveLength(1);
    });

    it('`FishSymbol.isLocal()`', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        "  echo 'hello'",
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      expect(flatSymbols.filter(s => s.isLocal())).toHaveLength(1);
      expect(flatSymbols.find(s => s.isLocal())!.name).toBe('argv');
    });

    // describe('`FishSymbol.isBefore()`/`FishSymbol.isAfter()`', () => {
    //   it('foo before argv', () => {
    //     const { doc, root } = testBuilder('config.fish',
    //       'function foo',
    //       "  echo 'hello'",
    //       'end',
    //     );
    //     const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
    //     const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
    //     const argvVariable = flatSymbols.find(s => s.name === 'argv')!;
    //     expect(fooFunction).toBeDefined();
    //     expect(argvVariable).toBeDefined();
    //     expect(fooFunction.isBefore(argvVariable)).toBeTruthy();
    //     expect(argvVariable.isAfter(fooFunction)).toBeTruthy();
    //   });
    //
    //   it('alias1 & alias2', () => {
    //     const { doc, root } = testBuilder('config.fish',
    //       "alias alias1='echo foo'",
    //       "alias alias2='echo bar'",
    //     );
    //     const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
    //     const alias1 = flatSymbols.find(s => s.name === 'alias1')!;
    //     const alias2 = flatSymbols.find(s => s.name === 'alias2')!;
    //     expect(alias1).toBeDefined();
    //     expect(alias2).toBeDefined();
    //     expect(alias1.isBefore(alias2)).toBeTruthy();
    //     expect(alias2.isAfter(alias1)).toBeTruthy();
    //   });
    //
    //   it('argparse', () => {
    //     const { doc, root } = testBuilder('config.fish',
    //       'function foo',
    //       '  argparse --stop-nonopt f/first s/second -- $argv',
    //       '  or return',
    //       '  echo $_flag_first',
    //       '  echo $_flag_second',
    //       'end',
    //     );
    //     const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
    //     const firstFlag = flatSymbols.find(s => s.name === '_flag_first')!;
    //     const secondFlag = flatSymbols.find(s => s.name === '_flag_second')!;
    //     expect(firstFlag).toBeDefined();
    //     expect(secondFlag).toBeDefined();
    //     expect(firstFlag.isBefore(secondFlag)).toBeTruthy();
    //     expect(secondFlag.isAfter(firstFlag)).toBeTruthy();
    //   });
    // });

    describe('`FishSymbol.equalScopes()`', () => {
      it('function foo && function bar', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
          'function bar',
          "  echo 'world'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        const barFunction = flatSymbols.find(s => s.name === 'bar')!;
        expect(fooFunction).toBeDefined();
        expect(barFunction).toBeDefined();
        expect(fooFunction.equalScopes(barFunction)).toBeTruthy();
      });
    });

    describe('`FishSymbol.toLocation()`', () => {
      it('function foo', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        const location = fooFunction.toLocation();
        expect(location).toEqual({
          uri: doc.uri,
          range: fooFunction.selectionRange,
        });
      });

      it('alias foo', () => {
        const { doc, root } = testBuilder('config.fish',
          "alias foo='echo foo'",
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooAlias = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooAlias).toBeDefined();
        const location = fooAlias.toLocation();
        expect(location).toEqual({
          uri: doc.uri,
          range: fooAlias.selectionRange,
        });
      });
      it.skip('argparse', () => {
      });
    });
    describe('`FishSymbol.toWorkspaceSymbol()`', () => {
      it('function foo', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const wsSymbols = flatSymbols.filter(s => s.isGlobal()).map(s => s.toWorkspaceSymbol());
        expect(wsSymbols).toHaveLength(1);
        const fooSymbol = wsSymbols[0]!;
        expect(fooSymbol).toEqual({
          name: 'foo',
          kind: LSP.SymbolKind.Function,
          location: {
            uri: doc.uri,
            range: flatSymbols[0]!.selectionRange,
          },
        });
      });
    });

    describe('`FishSymbol.isSymbolImmutable()`', () => {
      beforeEach(() => {
        config.fish_lsp_all_indexed_paths = [`${os.homedir()}/.config/fish`];
        config.fish_lsp_modifiable_paths = [`${os.homedir()}/.config/fish`];
      });

      it('`config.fish`', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo');
        expect(fooFunction).toBeDefined();
        expect(fooFunction!.isSymbolImmutable()).toBeFalsy();
      });

      it('`/usr/share/fish/foo.fish`', () => {
        const { doc, root } = testBuilder('/usr/share/fish/foo.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.isSymbolImmutable()).toBeTruthy();
      });
    });

    describe('`FishSymbol.toFoldingRange()`', () => {
      it('function foo', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        const foldingRange = fooFunction.toFoldingRange();
        expect(foldingRange).toEqual({
          startLine: 0,
          startCharacter: 0,
          endLine: 2,
          endCharacter: 3,
          collapsedText: 'foo',
          kind: LSP.FoldingRangeKind.Region,
        });
      });
    });

    describe('`FishSymbol.equals()`', () => {
      it('function', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          "  echo 'hello'",
          'end',
          'function bar',
          "  echo 'world'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction1 = flatSymbols.find(s => s.name === 'foo')!;
        const fooFunction2 = flatSymbols.find(s => s.name === 'foo')!;
        const barFunction1 = flatSymbols.find(s => s.name === 'bar')!;
        expect(fooFunction1).toBeDefined();
        expect(fooFunction2).toBeDefined();
        expect(barFunction1).toBeDefined();
        expect(fooFunction1.equals(fooFunction2)).toBeTruthy();
        expect(fooFunction1.equals(barFunction1)).toBeFalsy();
      });

      it('alias', () => {
        const { doc, root } = testBuilder('config.fish',
          "alias foo='echo foo'",
          "alias bar='echo bar'",
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooAlias1 = flatSymbols.find(s => s.name === 'foo')!;
        const fooAlias2 = flatSymbols.find(s => s.name === 'foo')!;
        const barAlias1 = flatSymbols.find(s => s.name === 'bar')!;
        expect(fooAlias1).toBeDefined();
        expect(fooAlias2).toBeDefined();
        expect(barAlias1).toBeDefined();
        expect(fooAlias1.equals(fooAlias2)).toBeTruthy();
        expect(fooAlias1.equals(barAlias1)).toBeFalsy();
      });

      it('variables', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx FOO foo',
          'set -gx BAR bar',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooVariable1 = flatSymbols.find(s => s.name === 'FOO')!;
        const fooVariable2 = flatSymbols.find(s => s.name === 'FOO')!;
        const barVariable1 = flatSymbols.find(s => s.name === 'BAR')!;
        expect(fooVariable1).toBeDefined();
        expect(fooVariable2).toBeDefined();
        expect(barVariable1).toBeDefined();
        expect(fooVariable1.equals(fooVariable2)).toBeTruthy();
        expect(fooVariable1.equals(barVariable1)).toBeFalsy();
      });

      it('argparse', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          '  argparse --stop-nonopt f/first s/second -- $argv',
          '  or return',
          '  echo $_flag_first',
          '  echo $_flag_second',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const firstFlag1 = flatSymbols.find(s => s.name === '_flag_first')!;
        const firstFlag2 = flatSymbols.find(s => s.name === '_flag_first')!;
        const secondFlag1 = flatSymbols.find(s => s.name === '_flag_second')!;
        expect(firstFlag1).toBeDefined();
        expect(firstFlag2).toBeDefined();
        expect(secondFlag1).toBeDefined();
        expect(firstFlag1.equals(firstFlag2)).toBeTruthy();
        expect(firstFlag1.equals(secondFlag1)).toBeFalsy();
      });

      it('nested functions', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          '  function foo',
          "    echo 'hello'",
          '  end',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunctions = flatSymbols.filter(s => s.name === 'foo')!;
        const fooFunctionOuter = fooFunctions[0]!;
        const fooFunctionInner = fooFunctions[1]!;
        expect(fooFunctionOuter).toBeDefined();
        expect(fooFunctionInner).toBeDefined();
        expect(fooFunctionOuter.equals(fooFunctionInner)).toBeFalsy();
      });
    });
    describe('`FishSymbol.path()`', () => {
      it('`config.fish`', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx PATH $PATH /usr/bin',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'PATH')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.path).toEqual(`${os.homedir()}/.config/fish/config.fish`);
      });

      it('`/usr/share/fish/foo.fish`', () => {
        const { doc, root } = testBuilder('/usr/share/fish/foo.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.path).toEqual('/usr/share/fish/foo.fish');
      });
    });

    describe('`FishSymbol.workspacePath()`', () => {
      it('`config.fish`', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx PATH $PATH /usr/bin',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'PATH')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.workspacePath).toEqual(`${os.homedir()}/.config/fish`);
      });

      it('`/usr/share/fish/foo.fish`', () => {
        const { doc, root } = testBuilder('/usr/share/fish/foo.fish',
          'function foo',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.workspacePath).toEqual('/usr/share/fish');
      });

      it('`/usr/share/fish/functions/bar.fish`', () => {
        const { doc, root } = testBuilder('/usr/share/fish/functions/bar.fish',
          'function bar',
          "  echo 'hello'",
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const barFunction = flatSymbols.find(s => s.name === 'bar')!;
        expect(barFunction).toBeDefined();
        expect(barFunction.workspacePath).toEqual('/usr/share/fish');
      });
    });

    describe('`FishSymbol.scopeNode()`', () => {
      it('`config.fish`', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx PATH $PATH /usr/bin',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'PATH')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.scopeNode.type === 'program').toBeTruthy();
      });
    });

    describe('`FishSymbol.scopeTag()`', () => {
      it('`config.fish`', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx PATH $PATH /usr/bin',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'PATH')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.scopeTag).toEqual('global');
      });
    });
  });

  describe('`FishSymbol` definition scope', () => {
    describe('FUNCTION', () => {
      it('`global`', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          '  echo "hello"',
          'end',
          'set -gx PATH $PATH /usr/bin',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        const pathVariable = flatSymbols.find(s => s.name === 'PATH')!;
        expect(fooFunction).toBeDefined();
        expect(pathVariable).toBeDefined();
        expect(fooFunction.isGlobal()).toBeTruthy();
        expect(fooFunction.scopeNode.type).toBe('program');
        expect(fooFunction.scopeTag).toBe('global');
        expect(fooFunction.scopeNode.equals(pathVariable.scopeNode)).toBeTruthy();
        expect(fooFunction.scopeTag === pathVariable.scopeTag).toBeTruthy();
      });

      it('`local script`', () => {
        const { doc, root } = testBuilder('/home/username/script.fish',
          '#!/usr/bin/env fish',
          'function foo',
          '  echo "hello"',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooFunction).toBeDefined();
        expect(fooFunction.isLocal()).toBeTruthy();
        expect(fooFunction.scopeNode.type).toBe('program');
        expect(fooFunction.scopeTag).toBe('local');
      });

      it('nested `local`', () => {
        const { doc, root } = testBuilder('config.fish',
          'function foo',
          '  function bar',
          '    echo "hello"',
          '  end',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        const barFunction = flatSymbols.find(s => s.name === 'bar')!;
        expect(fooFunction).toBeDefined();
        expect(barFunction).toBeDefined();
        expect(fooFunction.isGlobal()).toBeTruthy();
        expect(barFunction.isLocal()).toBeTruthy();
        expect(fooFunction.scopeNode.type).toBe('program');
        expect(fooFunction.scopeTag).toBe('global');
        expect(barFunction.scopeNode.type).toBe('function_definition');
        expect(barFunction.scopeNode.firstNamedChild!.text).toBe('foo');
        expect(barFunction.scopeTag).toBe('local');
      });

      it('alias', () => {
        const { doc, root } = testBuilder('conf.d/aliases.fish',
          'alias foo="echo foo"',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooAlias = flatSymbols.find(s => s.name === 'foo')!;
        expect(fooAlias).toBeDefined();
        expect(fooAlias.isGlobal()).toBeTruthy();
        expect(fooAlias.scopeNode.type).toBe('program');
        expect(fooAlias.scopeTag).toBe('global');
      });

      it('alias local', () => {
        const { doc, root } = testBuilder('conf.d/aliases.fish',
          'function foo',
          '  alias bar="echo foo"',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
        const barAlias = flatSymbols.find(s => s.name === 'bar')!;
        expect(fooFunction).toBeDefined();
        expect(barAlias).toBeDefined();
        expect(fooFunction.scopeNode.type).toBe('program');
        expect(fooFunction.scopeTag).toBe('global');
        expect(barAlias.scopeNode.type).toBe('function_definition');
        expect(barAlias.scopeTag).toBe('local');
      });
    });

    describe('VARIABLE', () => {
      it('`global` config.fish', () => {
        const { doc, root } = testBuilder('config.fish',
          'set -gx FOO foo',
          'set -gx BAR bar',
          'set -x BAZ baz',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
        const barVariable = flatSymbols.find(s => s.name === 'BAR')!;
        const bazVariable = flatSymbols.find(s => s.name === 'BAZ')!;
        expect(fooVariable).toBeDefined();
        expect(barVariable).toBeDefined();
        expect(bazVariable).toBeDefined();
        expect(fooVariable.isGlobal()).toBeTruthy();
        expect(barVariable.isGlobal()).toBeTruthy();
        expect(bazVariable.isGlobal()).toBeTruthy();
        expect(fooVariable.scopeNode.type).toBe('program');
        expect(barVariable.scopeNode.type).toBe('program');
        expect(bazVariable.scopeNode.type).toBe('program');
      });

      it('`global` conf.d/vars.fish', () => {
        const { doc, root } = testBuilder('conf.d/vars.fish',
          'set -gx FOO foo',
          'set -gx BAR bar',
          'set -x BAZ baz',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
        const barVariable = flatSymbols.find(s => s.name === 'BAR')!;
        const bazVariable = flatSymbols.find(s => s.name === 'BAZ')!;
        expect(fooVariable).toBeDefined();
        expect(barVariable).toBeDefined();
        expect(bazVariable).toBeDefined();
        expect(fooVariable.isGlobal()).toBeTruthy();
        expect(barVariable.isGlobal()).toBeTruthy();
        expect(bazVariable.isGlobal()).toBeTruthy();
        expect(fooVariable.scopeNode.type).toBe('program');
        expect(barVariable.scopeNode.type).toBe('program');
        expect(bazVariable.scopeNode.type).toBe('program');
      });

      it('`local`', () => {
        const { doc, root } = testBuilder('functions/_foo.fish',
          'function _foo',
          '  set -l FOO foo',
          '  set BAR $argv[1]',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
        const barVariable = flatSymbols.find(s => s.name === 'BAR')!;
        expect(fooVariable).toBeDefined();
        expect(barVariable).toBeDefined();
        expect(fooVariable.isLocal()).toBeTruthy();
        expect(barVariable.isLocal()).toBeTruthy();
        expect(fooVariable.scopeNode.type).toBe('function_definition');
        expect(barVariable.scopeNode.type).toBe('function_definition');
        expect(fooVariable.scopeNode.equals(barVariable.scopeNode)).toBeTruthy();
      });

      // it.skip('nested `local`', () => {
      // });

      it('for loop', () => {
        [
          testBuilder('functions/_foo.fish',
            'function _foo',
            '  for i in (seq 1 10)',
            '    set -l FOO foo',
            '    echo $i',
            '  end',
            'end',
          ),
          testBuilder('conf.d/_foo.fish',
            'for i in (seq 1 10)',
            '  echo $i',
            'end',
          ),
        ].forEach(({ doc, root }, idx) => {
          const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
          const iVariable = flatSymbols.find(s => s.name === 'i')!;
          expect(iVariable).toBeDefined();
          // if (idx === 0) {
          expect(iVariable.isLocal()).toBeTruthy();
          expect(iVariable.scopeNode.type).toBe('for_statement');
          // } else {
          //   expect(iVariable.isGlobal()).toBeTruthy();
          //   expect(iVariable.scopeNode.type).toBe('program');
          // }
        });
      });

      it('read `global`/`local`', () => {
        [
          testBuilder('conf.d/_foo.fish',
            'echo \'foo\' | read FOO',
          ),
          testBuilder('functions/_foo.fish',
            'function _foo',
            '  echo $argv[1] | read FOO',
            'end',
          ),
        ].forEach(({ doc, root }, idx) => {
          const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
          const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
          expect(fooVariable).toBeDefined();
          if (idx === 1) {
            expect(fooVariable.isLocal()).toBeTruthy();
            expect(fooVariable.scopeNode.type).toBe('function_definition');
          } else {
            expect(fooVariable.isGlobal()).toBeTruthy();
            expect(fooVariable.scopeNode.type).toBe('program');
          }
        });
      });

      it('argparse', () => {
        const { doc, root } = testBuilder('functions/foo.fish',
          'function foo',
          '  argparse --stop-nonopt f/first s/second -- $argv',
          '  or return',
          '  echo $_flag_first',
          '  echo $_flag_second',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const firstFlag = flatSymbols.find(s => s.name === '_flag_first')!;
        const secondFlag = flatSymbols.find(s => s.name === '_flag_second')!;
        expect(firstFlag).toBeDefined();
        expect(secondFlag).toBeDefined();
        expect(firstFlag.isLocal()).toBeTruthy();
        expect(secondFlag.isLocal()).toBeTruthy();
        expect(firstFlag.scopeNode.type).toBe('function_definition');
        expect(secondFlag.scopeNode.type).toBe('function_definition');
      });

      it('argument-names', () => {
        const { doc, root } = testBuilder('functions/foo.fish',
          'function foo --argument-names first second third',
          '  echo $first',
          '  echo $second',
          '  echo $third',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const firstArg = flatSymbols.find(s => s.name === 'first')!;
        const secondArg = flatSymbols.find(s => s.name === 'second')!;
        const thirdArg = flatSymbols.find(s => s.name === 'third')!;
        expect(firstArg).toBeDefined();
        expect(secondArg).toBeDefined();
        expect(thirdArg).toBeDefined();
        expect([firstArg, secondArg, thirdArg].filter(s => s.scopeTag === 'local')).toHaveLength(3);
        expect([firstArg, secondArg, thirdArg].filter(s => s.scopeNode.type === 'function_definition')).toHaveLength(3);
      });

      it('argv', () => {
        [
          testBuilder('functions/foo.fish',
            'function foo --argument-names first second third',
            '  echo $first',
            '  echo $second',
            '  echo $third',
            'end',
          ),
          testBuilder('script/foo',
            '#!/usr/bin/env fish',
            'echo $argv',
          ),
        ].map(({ doc, root }, idx) => {
          const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
          const argv = flatSymbols.find(s => s.name === 'argv')!;
          expect(argv).toBeDefined();
          expect(argv.isLocal()).toBeTruthy();
          if (idx === 0) {
            expect(argv.scopeNode.type).toBe('function_definition');
          } else if (idx === 1) {
            expect(argv.scopeNode.type).toBe('program');
          }
          expect(argv.scopeTag).toBe('local');
        });
      });
    });
  });

  describe('util functions', () => {
    it('`getLocalSymbols()`', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        '  set -l FOO foo',
        '  set BAR $argv[1]',
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const localSymbols = getLocalSymbols(flatSymbols);
      expect(localSymbols).toHaveLength(3);
      expect(localSymbols.map(s => s.name)).toEqual(['argv', 'FOO', 'BAR']);
    });

    it('`getGlobalSymbols()`', () => {
      const { doc, root } = testBuilder('config.fish',
        'set -gx FOO foo',
        'set -gx BAR bar',
        'set -x BAZ baz',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const globalSymbols = getGlobalSymbols(flatSymbols);
      expect(globalSymbols).toHaveLength(3);
      expect(globalSymbols.map(s => s.name)).toEqual(['FOO', 'BAR', 'BAZ']);
    });

    it('`isSymbol()`', () => {
      const { doc, root } = testBuilder('config.fish',
        'function foo',
        '  set -l FOO foo',
        '  set BAR $argv[1]',
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
      const barVariable = flatSymbols.find(s => s.name === 'BAR')!;
      expect(fooVariable).toBeDefined();
      expect(barVariable).toBeDefined();
      expect(flatSymbols.filter(s => s.fishKind === 'SET')).toHaveLength(2);
    });

    describe('`filterLastPerScopeSymbol()`)', () => {
      it('global for loops', () => {
        const { doc, root } = testBuilder('config.fish',
          'for i in (seq 1 10)',
          '  echo $i',
          'end',
          'for i in (seq 1 20)',
          '  echo $i',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const lastSymbols = filterLastPerScopeSymbol(flatSymbols);
        expect(lastSymbols).toHaveLength(2);
      });

      it('local for loops', () => {
        const { doc, root } = testBuilder('functions/foo.fish',
          'function foo',
          '  for i in (seq 1 10)',
          '    echo $i',
          '  end',
          '  for i in (seq 1 20)',
          '    echo $i',
          '  end',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const lastSymbols = filterLastPerScopeSymbol(flatSymbols);
        expect(lastSymbols).toHaveLength(4);
      });

      it('script for loops', () => {
        const { doc, root } = testBuilder('script/foo',
          '#!/usr/bin/env fish',
          'for i in (seq 1 10)',
          '  echo $i',
          'end',
          'for i in (seq 1 20)',
          '  echo $i',
          'end',
        );
        const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
        const lastSymbols = filterLastPerScopeSymbol(flatSymbols).filter(s => s.fishKind === 'FOR');
        expect(lastSymbols).toHaveLength(2);
      });

      it.skip('script variables', () => {
        const { doc, root } = testBuilder('script/foo',
          '#!/usr/bin/env fish',
          'function __foo --argument-names FOO',
          '    echo $FOO',
          'end',
          'set -l FOO foo',
          '__foo $FOO',
        );
        const { flatSymbols, symbols } = getAllTypesOfNestedArrays(doc, root);
        const lastSymbols = filterLastPerScopeSymbol(flatSymbols);
        console.log({
          all: flatSymbols.map(s => s.name),
          last: lastSymbols.map(s => s.name),
        });
        expect(lastSymbols).toHaveLength(5);
        expect(lastSymbols.map(s => s.name)).toEqual(['argv', '__foo', 'FOO', 'argv', 'FOO']);
      });
    });
  });

  describe('`FishSymbol` locations', () => {
    it('`function`', () => {
      const { doc, root } = testBuilder('script.fish',
        '#!/usr/bin/env fish',
        'function foo',
        '  echo "hello"',
        'end',
        'foo $argv',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const fooFunction = flatSymbols.find(s => s.name === 'foo')!;
      expect(fooFunction).toBeDefined();
      console.log({
        locals: findLocalLocations(fooFunction, flatSymbols),
        all: flatSymbols.filter(s => s.name === 'foo'),
      });
      const locals = findLocalLocations(fooFunction, flatSymbols);
      expect(locals).toHaveLength(2);
    });
    it('`alias`', () => {
      const { doc, root } = testBuilder('script.fish',
        '#!/usr/bin/env fish',
        'alias foo="echo \'foo\'"',
        'foo',
        'function foo',
        '  echo "hello"',
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const fooAlias = flatSymbols.find(s => s.name === 'foo')!;
      expect(fooAlias).toBeDefined();
      // console.log({
      //   locals: findLocalLocations(fooAlias, flatSymbols),
      //   all: flatSymbols.filter(s => s.name === 'foo'),
      // })
      // const locals = findLocalLocations(fooAlias, flatSymbols);
      expect(findLocalLocations(fooAlias, flatSymbols)).toHaveLength(3);
    });
    it('`variable`', () => {
      const { doc, root } = testBuilder('script.fish',
        '#!/usr/bin/env fish',
        'set -gx FOO foo',
        'echo $FOO',
        'function __util --argument-names FOO',
        '    set -l FOO foo',
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const fooVariable = flatSymbols.find(s => s.name === 'FOO')!;
      expect(fooVariable).toBeDefined();
      expect(findLocalLocations(fooVariable, flatSymbols)).toHaveLength(2);
    });
    it('`argument`', () => {
      const { doc, root } = testBuilder('script.fish',
        '#!/usr/bin/env fish',
        'function foo --argument-names first second',
        '  echo $first',
        '  echo $second',
        'end',
        'foo $argv',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const firstArg = flatSymbols.find(s => s.name === 'first')!;
      const secondArg = flatSymbols.find(s => s.name === 'second')!;
      expect(firstArg).toBeDefined();
      expect(secondArg).toBeDefined();
      expect(findLocalLocations(firstArg, flatSymbols)).toHaveLength(1);
      expect(findLocalLocations(secondArg, flatSymbols)).toHaveLength(1);
    });
    it('`argparse`', () => {
      const { doc, root } = testBuilder('functions/foo.fish',
        'function foo',
        '  argparse --stop-nonopt f/first s/second -- $argv',
        '  or return',
        '  echo $_flag_first',
        '  echo $_flag_second',
        'end',
      );
      const { flatSymbols } = getAllTypesOfNestedArrays(doc, root);
      const firstFlag = flatSymbols.find(s => s.name === '_flag_first')!;
      const secondFlag = flatSymbols.find(s => s.name === '_flag_second')!;
      expect(firstFlag).toBeDefined();
      expect(secondFlag).toBeDefined();
      // console.log(JSON.stringify(findLocalLocations(firstFlag, flatSymbols), null, 2));
      expect(findLocalLocations(firstFlag, flatSymbols)).toHaveLength(2);
      expect(findLocalLocations(secondFlag, flatSymbols)).toHaveLength(2);
      const { doc: completionDoc, root: completionRoot } = testBuilder('completions/foo.fish',
        'complete -c foo -s f -l first -d "first flag"',
        'complete -c foo -s s -l second -d "second flag"',
      );
      const { flatSymbols: completionSymbols } = getAllTypesOfNestedArrays(completionDoc, completionRoot);
      const firstCompletions = findLocalLocations(firstFlag, completionSymbols, false);
      const secondCompletions = findLocalLocations(secondFlag, completionSymbols, false);
      // console.log(JSON.stringify(completions, null, 2));
      expect(firstCompletions).toHaveLength(1);
      expect(secondCompletions).toHaveLength(1);
    });
  });
});
