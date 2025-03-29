import { Parsers, Option, ParsingDefinitionNames, DefinitionNodeNames } from '../src/parsing/barrel';
import { execAsyncF } from '../src/utils/exec';

import { initializeParser } from '../src/parser';
import { createFakeLspDocument, setLogger } from './helpers';
// import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../src/utils/node-types';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { processAliasCommand } from '../src/parsing/alias';
import { flattenNested } from '../src/utils/flatten';
import { isCommandWithName, isEndStdinCharacter, isFunctionDefinition } from '../src/utils/node-types';
import { findOptionsSet, LongFlag, ShortFlag } from '../src/parsing/options';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { SymbolKind } from 'vscode-languageserver';
import { md } from '../src/utils/markdown-builder';
import { isFunctionDefinitionName } from '../src/parsing/function';

let parser: Parser;
type PrintClientTreeOpts = { log: boolean; };
function printClientTree(
  opts: PrintClientTreeOpts = { log: true },
  ...symbols: FishSymbol[]
): string[] {
  const result: string[] = [];

  function logAtLevel(indent = '', ...remainingSymbols: FishSymbol[]) {
    const newResult: string[] = [];
    remainingSymbols.forEach(n => {
      if (opts.log) {
        console.log(`${indent}${n.name} --- ${n.fishKind} --- ${n.scope.scopeTag} --- ${n.scope.scopeNode.firstNamedChild?.text}`);
      }
      newResult.push(`${indent}${n.name}`);
      newResult.push(...logAtLevel(indent + '    ', ...n.children));
    });
    return newResult;
  }
  result.push(...logAtLevel('', ...symbols));
  return result;
}

describe('parsing symbols', () => {
  setLogger();
  beforeEach(async () => {
    setupProcessEnvExecFile();
    parser = await initializeParser();
  });

  describe('test options/flags vs shell completions', () => {
    async function getCompletionsForCommand(command: string) {
      const output = await execAsyncF(`complete --do-complete '${command} -'`);
      return output.split('\n')
        .filter(Boolean)
        .map(line => line.split('\t'));
    }

    function getFlagsFromCompletion(completions: string[][]): string[] {
      return completions.map(c => c[0]).filter(Boolean) as string[];
    }

    function getAllOptionFlags(flags: Option[]): string[] {
      const result: string[] = [];
      for (const flag of flags) {
        result.push(...flag.getAllFlags());
      }
      return result.filter(Boolean);
    }

    it('function -', async () => {
      const completions = await getCompletionsForCommand('function');
      const flags = getFlagsFromCompletion(completions);
      for (const flag of flags) {
        if (!getAllOptionFlags(Parsers.function.FunctionOptions).includes(flag)) {
          console.log('missing:', flag);
        }
      }
      expect(flags.length).toBe(getAllOptionFlags(Parsers.function.FunctionOptions).length);
    });

    it('set -', async () => {
      const completions = await getCompletionsForCommand('set');
      const flags = getFlagsFromCompletion(completions);
      for (const flag of flags) {
        if (!getAllOptionFlags(Parsers.set.SetOptions).includes(flag)) {
          // console.log('missing:', flag);
        }
      }
      // console.log(flags, getAllOptionFlags(Set.SetOptions))
      expect(flags.length).toBe(getAllOptionFlags(Parsers.set.SetOptions).length);
    });

    it('read -', async () => {
      const completions = await getCompletionsForCommand('read');
      const flags = getFlagsFromCompletion(completions);
      for (const flag of flags) {
        if (!getAllOptionFlags(Parsers.read.ReadOptions).includes(flag)) {
          console.log('missing:', flag);
        }
      }
      expect(flags.length).toBe(getAllOptionFlags(Parsers.read.ReadOptions).length);
    });

    it('argparse -', async () => {
      const completions = await getCompletionsForCommand('argparse');
      const flags = getFlagsFromCompletion(completions);
      for (const flag of flags) {
        if (!getAllOptionFlags(Parsers.argparse.ArparseOptions).includes(flag)) {
          console.log('missing:', flag);
        }
      }
      expect(flags.length).toBe(getAllOptionFlags(Parsers.argparse.ArparseOptions).length);
    });

    it('for -', async () => {
      const completions = await getCompletionsForCommand('for');
      const flags = getFlagsFromCompletion(completions);
      expect(flags.length).toBe(['-h', '--help'].length);
    });

    it('complete -', async () => {
      const completions = await getCompletionsForCommand('complete');
      const flags = getFlagsFromCompletion(completions);
      for (const flag of flags) {
        if (!getAllOptionFlags(Parsers.complete.CompleteOptions).includes(flag)) {
          console.log('missing:', flag);
        }
      }
      expect(flags.length).toBe(getAllOptionFlags(Parsers.complete.CompleteOptions).length);
    });
  });

  describe('test finding definitions', () => {
    it('function', async () => {
      const source = 'function foo; echo \'inside foo\'; end';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(isFunctionDefinition);
      expect(foundNode).toBeDefined();
    });

    it('set', async () => {
      const source = 'set -U foo (echo \'universal var\')';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(Parsers.set.isSetDefinition);
      expect(foundNode).toBeDefined();
    });

    it('read', async () => {
      const source = 'read -l foo';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(Parsers.read.isReadDefinition);
      expect(foundNode).toBeDefined();
    });

    it('argparse', async () => {
      const source = 'argparse --name foo h/help -- $argv; or return';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(Parsers.argparse.isArgparseVariableDefinitionName);
      expect(foundNode).toBeDefined();
    });

    it('for', async () => {
      const source = 'for i in 1 2 3; echo $i; end';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(n => n.type === 'for_statement');
      // if (foundNode) {
      //   console.log('foundNode', foundNode.firstNamedChild?.type);
      // }
      expect(foundNode).toBeDefined();
    });

    it('complete', async () => {
      const source = 'complete -c foo -f -a \'bar\'';
      const { rootNode } = parser.parse(source);
      const foundNode = getChildNodes(rootNode).find(Parsers.complete.isCompletionDefinition);
      expect(foundNode).toBeDefined();
    });
  });

  describe('new options class', () => {
    it('complete1', async () => {
      const source = 'complete -c foo -f -a \'bar\' --keep-order --description \'this is a description\'';
      const toMatch: string[] = [
        '-c, --command',
        '-f, --no-files',
        '-a, --arguments',
        '-k, --keep-order',
        '-d, --description',
      ];
      const { rootNode } = parser.parse(source);
      // console.log('options', _cmp_options.map(o => o.flags().join(',')));
      const result: string[] = [];
      for (const child of getChildNodes(rootNode)) {
        const opt = _cmp_options.filter(o => o.matches(child));
        if (opt.length) {
          opt.forEach(o => result.push(o.getAllFlags().join(', ')));
        }
      }
      expect(result).toEqual(toMatch);
    });
    it('complete2', async () => {
      const source = [
        'complete -c foo -f -s h --long-option help ',
        'complete -c foo -s f -l files -xa \'a b c\'',
      ].join('\n');
      const { rootNode } = parser.parse(source);
      // console.log('options', _cmp_options.map(o => o.flags().join(',')));
      const result: string[] = [];
      for (const child of getNamedChildNodes(rootNode)) {
        // const opts = _cmp_options.filter(o => o.equalsFlag(child));
        const vals = _cmp_options.filter(o => o.matches(child));
        if (vals.length >= 1) {
          result.push(...vals.map(o => o.getAllFlags().join(', ')));
          // console.log('found value', { node: child.text, val: vals.map(o => o.flags()) });
        }
      }
      expect(result).toEqual([
        '-c, --command',
        '-f, --no-files',
        '-s, --short-option',
        '-l, --long-option',
        '-c, --command',
        '-s, --short-option',
        '-l, --long-option',
        '-a, --arguments',
        '-x, --exclusive',
      ]);
      // console.log('result', result);
    });
    it('function -a', async () => {
      const source = [
        'function foo --argument-names a b c d e \\',
        '          --description \'this is a description\' \\',
        '          --wraps \'echo\' \\',
        '          --inherit-variable v1 \\',
        '          --no-scope-shadowing',
        '     echo $v1',
        'end',
      ].join('\n');
      const { rootNode } = parser.parse(source);
      const funcNode = getChildNodes(rootNode).find(isFunctionDefinition)!;

      const children = funcNode?.childrenForFieldName('option').filter(n => n.type !== 'escape_sequence') as SyntaxNode[];
      const results = Parsers.options.findOptionsSet(children, _fn_options);
      const opts: Set<string> = new Set(results.map(({ option }) => option.getAllFlags().join(', ')));
      expect(opts.size).toBe(5);
    });
  });

  describe('process symbol definitions', () => {
    describe('local', () => {
      it('set', async () => {
        const source = 'set -U foo (echo \'universal var\')';
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('config.fish', source);
        const setNode = processNestedTree(document, rootNode);
        expect(setNode).toBeDefined();
        const flat = flattenNested<FishSymbol>(...setNode);
        expect(flat.length).toBe(1);
        // console.log({ setNode: setNode!.toString() });
      });

      it('read', async () => {
        const source = 'echo a b c d e | read --delimiter \' \' a b c d e';
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('config.fish', source);
        const readNode = processNestedTree(document, rootNode);
        // console.log({ readNode: readNode!.toString() });
        const flat = flattenNested<FishSymbol>(...readNode);
        expect(flat.length).toBe(5);
      });

      it('argparse', async () => {
        const source = [
          'function foo --argument-names a b c d e ',
          '     argparse -i h/help b/based -- $argv',
          '     or return',
          '     echo hi',
          'end',
        ].join('\n');
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('functions/foo.fish', source);
        const argparseNode = processNestedTree(document, rootNode);
        // console.log({ argparseNode: argparseNode?.toString() });
        const flat = flattenNested<FishSymbol>(...argparseNode);
        expect(flat.length).toBe(11);
        const argparseSymbols = flat.filter(n => n.fishKind === 'ARGPARSE');
        expect(argparseSymbols.length).toBe(4);
      });

      it('argparse script', async () => {
        const input = ['function _test',
          '    argparse h/help a/args -- $argv',

          '    or return',

          '    if set -lq _flag_help',
          '        echo "Usage: _test [-h|--help] [-a|--args]"',
          '        return',
          '    end',
          '',
          '    if set -lq _flag_args',
          '',
          '    end',
          'end',
        ].join('\n');
        const { rootNode } = parser.parse(input);
        const document = createFakeLspDocument('/tmp/foo.fish', input);
        const argparseNode = processNestedTree(document, rootNode);
        const flat = flattenNested<FishSymbol>(...argparseNode)
          .filter(n => n.fishKind === 'ARGPARSE');
        expect(flat.length).toBe(4);
      });

      it('for', async () => {
        const source = [
          'function foo --argument-names a b c d e ',
          '     for i in $argv',
          '         echo $i',
          '     end',
          'end',
        ].join('\n');
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('functions/foo.fish', source);
        const forNode = processNestedTree(document, rootNode);
        // console.log({ forNode: forNode?.toString() });
        const flat = flattenNested<FishSymbol>(...forNode);
        expect(flat.length).toBe(8);
        const forSymbol = flat.find(n => n.fishKind === 'FOR')!;
        expect(forSymbol).toBeDefined();
        expect(forSymbol.scope.scopeTag).toBe('local');
      });

      it('complete', async () => {

      });

      it('alias', async () => {
        const source = 'alias foo \'echo hi\'';
        const document = createFakeLspDocument('functions/foo.fish', source);
        const { rootNode } = parser.parse(source);
        const aliasNode = getChildNodes(rootNode).find(n => isCommandWithName(n, 'alias'))!;
        const aliasSymbol = processAliasCommand(document, aliasNode).pop()!;
        expect(aliasSymbol).toBeDefined();
        expect(aliasSymbol!.scope.scopeTag).toBe('local');
        expect(aliasSymbol!.name).toEqual('foo');
        const flat = flattenNested<FishSymbol>(aliasSymbol);
        expect(flat.length).toBe(1);
        expect(flat[0]!.fishKind).toBe('ALIAS');
      });

      it('function', async () => {
        const source = [
          'function foo --argument-names a b c d e \\',
          '          --description \'this is a description\' \\',
          '          --wraps \'echo\' \\',
          '          --inherit-variable v1 \\',
          '          --no-scope-shadowing',
          '     echo $v1',
          '     function bar --argument-names aaa',
          '         echo $aaa',
          '     end',
          'end',
        ].join('\n');
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('functions/foo.fish', source);
        const funcNode = processNestedTree(document, rootNode);
        // console.log({ funcNode: funcNode?.toString() });
        const flat = flattenNested<FishSymbol>(...funcNode);
        expect(flat.length).toBe(11);
        expect(flat.filter(n => n.fishKind === 'FUNCTION').length).toBe(2);
      });
    });

    describe('global', () => {
      it('set', async () => {
        const source = [
          'function foo --argument-names a b c d e \\',
          '          --description \'this is a description\' \\',
          '          --wraps \'echo\' \\',
          '          --inherit-variable v1 \\',
          '          --no-scope-shadowing',
          '     set -gx abcde 1',
          '     set -gx __two 2',
          '     set -gx __three 3',
          '     function bar',
          '         set -gx __four 4',
          '     end',
          'end',
        ].join('\n');
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('functions/foo.fish', source);
        const funcNode = processNestedTree(document, rootNode);
        const flat = flattenNested<FishSymbol>(...funcNode);
        const funcs = flat.filter(n => n.fishKind === 'FUNCTION');
        expect(funcs.length).toBe(2);
        expect(funcs[0]!.scope.scopeTag).toBe('global');
        expect(funcs[1]!.scope.scopeTag).toBe('local');
        expect(flat.length).toBe(14);
        expect(flat.filter(n => n.name === 'argv').length).toBe(2);
        // for (const item of flat) {
        //   console.log(item.name, item.fishKind);
        // }
      });

      it('read', async () => {

      });

      it('argparse', async () => {

      });

      it('for', async () => {

      });

      it('alias', async () => {
        const source = 'alias foo \'echo hi\'';
        const document = createFakeLspDocument('conf.d/foo.fish', source);
        const { rootNode } = parser.parse(source);
        const aliasNode = getChildNodes(rootNode).find(n => isCommandWithName(n, 'alias'))!;
        const aliasSymbol = processAliasCommand(document, aliasNode).pop()!;
        expect(aliasSymbol).toBeDefined();
        expect(aliasSymbol!.scope.scopeTag).toBe('global');
        // console.log({ aliasSymbol: aliasSymbol.toString() });
      });

      it('complete', async () => {

      });

      it('function', async () => {

      });
    });

    describe('skip processing', () => {
      it('set -q', async () => {
        const source = 'set -lq foo bar baz';
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('config.fish', source);
        const setNode = processNestedTree(document, rootNode);
        expect(setNode.length).toBe(0);
      });

      it('set --query', async () => {
        const source = 'set --query foo bar baz';
        const { rootNode } = parser.parse(source);
        const document = createFakeLspDocument('config.fish', source);
        const setNode = processNestedTree(document, rootNode);
        expect(setNode.length).toBe(0);
      });
    });
  });

  describe('test options file', () => {
    const logResult = (
      results: {
        found: { option: Option; value: SyntaxNode; }[];
        remaining: SyntaxNode[];
        unused: Option[];
      }) => {
      results.found.forEach(({ option, value }) => {
        console.log('found', option.getAllFlags(), value.text);
      });
      results.remaining.forEach(opt => {
        console.log('remaining', opt.text);
      });
      results.unused.forEach(opt => {
        console.log('unused', opt.getAllFlags().join(', '));
      });
    };

    describe('findOptions', () => {
      it('Argparse findOptions()', async () => {
        const source = 'argparse --name foo h/help -- $argv; or return';
        const { rootNode } = parser.parse(source);
        const argparseOptions = Array.from(Parsers.argparse.ArparseOptions);
        const focusedNode = getChildNodes(rootNode).find(n => isCommandWithName(n, 'argparse'))!;
        const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;
        const endStdin = focusedNode.children.find(n => isEndStdinCharacter(n))!;
        const search = focusedNode.childrenForFieldName('argument')!.filter(n => isBefore(n, endStdin));
        const results = Parsers.options.findOptions(search, argparseOptions);
        // logResult(results);
        expect(results.found.length).toBe(1);
        expect(results.remaining.length).toBe(1);
        expect(results.unused.length).toBe(6);
      });

      it('Set findOptions()', async () => {
        const source = 'set -U foo (echo \'universal var\')';
        const { rootNode } = parser.parse(source);
        const focusedNode = getChildNodes(rootNode).find(n => isCommandWithName(n, 'set'))!;

        const search = Parsers.set.findSetChildren(focusedNode);
        const setOptions = Parsers.set.SetOptions;
        const results = Parsers.options.findOptions(search, setOptions);
        // logResult(results);
        expect(results.found.length).toBe(1);
        expect(results.remaining.length).toBe(1);
        expect(results.unused.length).toBe(16);
      });

      it('Read findOptions()', async () => {
        const source = 'read -l foo bar baz';
        const { rootNode } = parser.parse(source);
        const focusedNode = getChildNodes(rootNode).find(n => isCommandWithName(n, 'read'))!;

        const search = focusedNode.childrenForFieldName('argument')!;
        const readOptions = Parsers.read.ReadOptions;
        const results = Parsers.options.findOptions(search, readOptions);
        // logResult(results);
        expect(results.found.length).toBe(1);
        expect(results.remaining.length).toBe(3);
        expect(results.unused.length).toBe(18);
      });

      it('Function findOptions()', async () => {
        const source = 'function foo --argument-names a b c d e; echo $a; end';
        const { rootNode } = parser.parse(source);
        const focusedNode = getChildNodes(rootNode).find(n => n.type === 'function_definition')!;
        const search = focusedNode.childrenForFieldName('option')!;
        const functionOptions = Parsers.function.FunctionOptions;
        const results = Parsers.options.findOptions(search, functionOptions);
        // const opts = findOptionsSet(focusedNode.childrenForFieldName('option')!, functionOptions);
        // for (const n of focusedNode.childrenForFieldName('option')!) {
        //   const opt = Option.create('-a', '--argument-names').withMultipleValues()
        //   console.log({
        //     matchesValue: opt.matchesValue(n),
        //     isSet: opt.isSet(n),
        //     text: n.text
        //   });
        //   console.log(Option.create('-a', '--argument-names').withMultipleValues().matchesValue(n), n.text);
        // }
        // logResult(results);
        expect(results.found.length).toBe(5);
        expect(results.remaining.length).toBe(0);
        expect(results.unused.length).toBe(5);
      });
    });

    describe('test raw equals', () => {
      it('equals raw long option', () => {
        const options = Parsers.function.FunctionOptions;
        const searchLongOptions: LongFlag[] = ['--argument-names', '--description', '--wraps', '--on-event', '--on-variable'];
        const found = options.filter(o => o.equalsRawLongOption(...searchLongOptions));
        expect(searchLongOptions.length).toBe(found.length);
      });

      it('equals raw short option', () => {
        const options = Parsers.function.FunctionOptions;
        const searchShortOptions: ShortFlag[] = ['-a', '-d', '-w', '-e', '-v'];
        const found = options.filter(o => o.equalsRawShortOption(...searchShortOptions));
        expect(searchShortOptions.length).toBe(found.length);
      });

      it('equals raw option', () => {
        const options = Parsers.function.FunctionOptions;
        const searchOptions: (ShortFlag | LongFlag)[] = [
          '-a', '--argument-names',
          '-d', '--description',
          '-w', '--wraps',
          '-e', '--on-event',
          '-v', '--on-variable',
        ];
        const found = options.filter(o => o.equalsRawOption(...searchOptions));
        expect(found.length).toBe(5);
      });
    });

    describe('test equivalent options', () => {
      it('isOption()', () => {
        const options = Parsers.function.FunctionOptions;
        const searchOptions: [ShortFlag, LongFlag][] = [
          ['-a', '--argument-names'],
          ['-d', '--description'],
          ['-w', '--wraps'],
          ['-e', '--on-event'],
          ['-v', '--on-variable'],
        ];
        searchOptions.forEach(([short, long]) => {
          expect(options.find(o => o.isOption(short, long))).toBeDefined();
        });
      });
    });
  });

  describe('show symbol details', () => {
    it('function foo', async () => {
      const source = [
        'function foo --argument-names a b c d e \\',
        '          --description \'this is a description\' \\',
        '          --wraps \'echo\' \\',
        '          --inherit-variable v1 \\',
        '          --no-scope-shadowing',
        '     alias ls=\'exa -1 -a --color=always\'',
        '     set -gx abcde 1',
        '     set -gx __two 2',
        '     set -gx __three 3',
        '     set -gx fish_lsp_enabled_handlers complete',
        '     function bar',
        '         argparse h/help "n/name" -- $argv',
        '         or return',
        '         set -gx __four 4',
        '     end',
        'end',
      ].join('\n');
      const { rootNode } = parser.parse(source);
      const document = createFakeLspDocument('functions/foo.fish', source);
      const funcNode = processNestedTree(document, rootNode);
      const flat = flattenNested<FishSymbol>(...funcNode);
      const funcs = flat.filter(n => n.fishKind === 'FUNCTION');
      expect(funcs.length).toBe(2);
      expect(funcs.at(0)!.detail.split('\n').at(-2)!).toBe('foo a b c d e'); // -2 to skip ```
      expect(funcs.at(1)!.detail.split('\n').at(-2)!).toBe('end'); // check that end is properly formatted
      // console.log('-'.repeat(80));
      // for (const func of funcs) {
      //   console.log(func.detail.toString());
      //   console.log('-'.repeat(80));
      // }
      const aliases = flat.filter(n => n.fishKind === 'ALIAS');
      // console.log('-'.repeat(80));
      // for (const func of aliases) {
      //   console.log(func.detail.toString());
      //   console.log('-'.repeat(80));
      // }
      expect(aliases.at(0)!.detail.split('\n').filter(line => line === md.separator()).length).toBe(2);

      // console.log('-'.repeat(80));
      const variables = flat.filter(n => n.kind === SymbolKind.Variable);
      expect(variables.length).toBe(17);
      // for (const variable of variables) {
      //   console.log(variable.detail.toString());
      //   console.log('-'.repeat(80));
      // }
      // const argparse = flat.filter(n => n.fishKind === 'ARGPARSE');
      // for (const arg of argparse) {
      //   console.log(arg.name, { aliases: arg.aliasedNames });
      //   console.log('-'.repeat(80));
      //   const argumentNamesOption = arg.aliasedNames
      //     .map(n => n.slice(`_flag_`.length).replace(/_/g, '-'))
      //     .map(n => n.length === 1 ? `${'cmd'} -${n.toString()}` : `cmd --${n.toString()}`)
      //     .join('\n');
      //   console.log(argumentNamesOption);
      // }
    });
  });

  describe('client trees', () => {
    it('show simple autoloaded DocumentSymbol client tree', () => {
      const source = [
        'function foo --argument-names a b c d e',
        '    echo $a',
        '    echo $b',
        '    echo $c',
        '    echo $d',
        '    echo $e',
        'end',
      ].join('\n');
      const document = createFakeLspDocument('functions/foo.fish', source);
      const { rootNode } = parser.parse(source);
      const symbolsTree = processNestedTree(document, rootNode);
      const flatSymbols = flattenNested(...symbolsTree);
      expect(symbolsTree.length).not.toBe(flatSymbols.length);
      // printClientTree({log: true},...symbolsTree);
      const tree = printClientTree({ log: false }, ...symbolsTree);
      // console.log(tree.join('\n'));
      expect(tree.join('\n')).toBe([
        'foo',
        '    argv',
        '    a',
        '    b',
        '    c',
        '    d',
        '    e'].join('\n'),
      );
    });
  });

  describe('test SyntaxNode checking', () => {
    describe('function names', () => {
      it('function_definition', () => {
        const source = 'function foo; echo \'inside foo\'; end';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isFunctionDefinitionName)!;
        expect(foundNode).toBeDefined();
        expect(foundNode.text).toBe('foo');
      });

      it('alias', () => {
        const source = 'alias foo \'echo hi\'';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isAliasDefinitionName)!;
        expect(foundNode).toBeDefined();
        expect(foundNode.text).toBe('foo');
      });

      it('alias concatenation', () => {
        const source = 'alias foo=\'echo hi\'';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isAliasDefinitionName)!;
        getNamedChildNodes(foundNode).forEach(n => {
          if (n.type === 'concatenation') {
            console.log({
              text: n.text,
              firstChild: n.firstChild?.text,
            });
          }
        });
        expect(foundNode).toBeDefined();
        expect(foundNode.text.split('=').at(0)!).toBe('foo');
      });
    });

    describe('variable names', () => {
      it('set', () => {
        const source = 'set -U foo (echo \'universal var\')';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isSetVariableDefinitionName)!;
        expect(foundNode).toBeDefined();
        expect(foundNode.text).toBe('foo');
      });
      it('set -q', () => {
        const source = 'set -ql foo (echo \'universal var\')';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isSetVariableDefinitionName);
        expect(foundNode).toBeUndefined();
      });
      it('read', () => {
        const source = 'read -l foo bar baz';
        const { rootNode } = parser.parse(source);
        const foundNodes = getChildNodes(rootNode).filter(ParsingDefinitionNames.isReadVariableDefinitionName)!;
        expect(foundNodes.length).toBe(3);
        expect(foundNodes.map(n => n.text)).toEqual(['foo', 'bar', 'baz']);
      });
      it('argparse', () => {
        const source = 'argparse --name foo h/help -- $argv';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isArgparseVariableDefinitionName)!;
        expect(foundNode).toBeDefined();
        expect(foundNode.text).toBe('h/help');
      });
      it('for', () => {
        const source = 'for foo in $argv; echo $foo; end';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(ParsingDefinitionNames.isForVariableDefinitionName)!;
        expect(foundNode).toBeDefined();
        expect(foundNode.text).toBe('foo');
      });
      it('function --flags', () => {
        const source = 'function foo --argument-names a b c d e --description \'this is a description\' --wraps \'echo\' --inherit-variable v1 --no-scope-shadowing; end;';
        const { rootNode } = parser.parse(source);
        const foundNodes = getChildNodes(rootNode).filter(ParsingDefinitionNames.isFunctionVariableDefinitionName)!;
        expect(foundNodes.map(n => n.text)).toEqual(['a', 'b', 'c', 'd', 'e', 'v1']);
      });
    });

    describe('isDefinitionName', () => {
      const tests = [
        {
          input: 'function foo; echo \'inside foo\'; end',
          expected: ['foo'],
        },
        {
          input: 'alias foo \'echo hi\'',
          expected: ['foo'],
        },
        {
          input: 'alias foo=\'echo hi\'',
          expected: ['foo='],
        },
        {
          input: 'set -g foo (echo \'global var\')',
          expected: ['foo'],
        },
        {
          input: 'read -l foo bar baz',
          expected: ['foo', 'bar', 'baz'],
        },
        {
          input: 'argparse --name foo h/help -- $argv',
          expected: ['h/help'],
        },
        {
          input: 'for foo in $argv; echo $foo; end',
          expected: ['foo'],
        },
        {
          input: 'function foo --argument-names a b c d e --description \'this is a description\' --wraps \'echo\' --inherit-variable v1 --no-scope-shadowing; end;',
          expected: ['foo', 'a', 'b', 'c', 'd', 'e', 'v1'],
        },
      ];

      tests.forEach(({ input, expected }) => {
        it(input, () => {
          const { rootNode } = parser.parse(input);
          const foundNodes = getChildNodes(rootNode).filter(DefinitionNodeNames.isDefinitionName)!;
          expect(foundNodes.map(n => n.text)).toEqual(expected);
        });
      });
    });
  });
});

const _cmp_options = [
  Option.create('-c', '--command').withValue(),
  Option.create('-f', '--no-files'),
  Option.create('-a', '--arguments').withValue(),
  Option.create('-s', '--short-option').withValue(),
  Option.create('-l', '--long-option').withValue(),
  Option.create('-k', '--keep-order'),
  Option.create('-d', '--description').withValue(),
  Option.create('-x', '--exclusive'),
  Option.create('-r', '--require-parameter'),
];

const _fn_options = [
  Option.create('-a', '--argument-names').withMultipleValues(),
  Option.create('-d', '--description').withValue(),
  Option.create('-w', '--wraps').withValue(),
  Option.create('-V', '--inherit-variable').withValue(),
  Option.create('-S', '--no-scope-shadowing'),
];
