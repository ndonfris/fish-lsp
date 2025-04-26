import { Parsers, Option, ParsingDefinitionNames, DefinitionNodeNames } from '../src/parsing/barrel';
import { execAsyncF } from '../src/utils/exec';

import { initializeParser } from '../src/parser';
import { createFakeLspDocument, createTestWorkspace, createFakeUriPath, setLogger } from './helpers';
// import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../src/utils/node-types';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { processAliasCommand } from '../src/parsing/alias';
import { flattenNested } from '../src/utils/flatten';
import { isCommandWithName, isCompleteCommandName, isEndStdinCharacter, isFunctionDefinition } from '../src/utils/node-types';
import { findOptionsSet, LongFlag, ShortFlag } from '../src/parsing/options';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { SymbolKind } from 'vscode-languageserver';
import { md } from '../src/utils/markdown-builder';
// import { isFunctionDefinitionName } from '../src/parsing/function';
import { getExpandedSourcedFilenameNode, isExistingSourceFilenameNode, isSourcedFilename, isSourceCommandName, isSourceCommandWithArgument, isSourceCommandArgumentName } from '../src/parsing/source';
import { SyncFileHelper } from '../src/utils/file-operations';
import * as Diagnostics from '../src/diagnostics/node-types';
import { Analyzer } from '../src/analyze';
import { groupVerboseCompletionSymbolsTogether, isCompletionDefinition, isCompletionSymbol, isCompletionSymbolVerbose, processCompletion, VerboseCompletionSymbol } from '../src/parsing/complete';
import { getGlobalArgparseLocations, isArgparseVariableDefinitionName, isGlobalArgparseDefinition } from '../src/parsing/argparse';
import { currentWorkspace, Workspace, workspaces } from '../src/utils/workspace';
import { LspDocument } from '../src/document';

let analyzer: Analyzer;
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
    await setupProcessEnvExecFile();
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

  describe('source', () => {
    describe('isSourceCommandName()', () => {
      it('input with 4 sources', () => {
        const input = [
          'source $__fish_data_dir/config.fish --help',
          '. $__fish_data_dir/config.fish --help',
          'source $__fish_data_dir/config.fish > /dev/null',
          'thefuck --alias | source',
        ].join('\n');
        const { rootNode } = parser.parse(input);
        const foundNodes = getChildNodes(rootNode).filter(isSourceCommandName);
        expect(foundNodes).toHaveLength(4);
      });
    });

    describe('isSourceCommandWithArgument()', () => {
      it('source $__fish_data_dir/config.fish --help', () => {
        const source = 'source $__fish_data_dir/config.fish --help';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(isSourceCommandWithArgument);
        expect(foundNode).toBeDefined();
      });

      it('echo "complete -c foo -e" | source', () => {
        const source = 'echo "complete -c foo -e" | source';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(isSourceCommandWithArgument);
        expect(foundNode).toBeUndefined();
      });
    });

    describe('isSourcedFilename() && isExistingSourcedFilenameNode())', () => {
      describe('command syntax using source command: `source some_file`', () => {
        it('Does not exist', () => {
          const source = 'source __file_does_not_exist.fish';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n))!;
          expect(foundNode).toBeDefined();
          expect(foundNode.text).toBe('__file_does_not_exist.fish');
          expect(isExistingSourceFilenameNode(foundNode)).toBeFalsy();
        });

        it('Does exist', () => {
          const source = 'source $__fish_data_dir/config.fish';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n))!;
          expect(foundNode).toBeDefined();
          // console.log(foundNode.text);
          const expanded = SyncFileHelper.expandEnvVars(foundNode.text);
          console.log({
            text: foundNode.text,
            expanded,
          });
          expect(expanded.startsWith('$')).toBeFalsy();
          expect(isExistingSourceFilenameNode(foundNode)).toBeTruthy();
        });

        it('Multiple arguments to source file', () => {
          const source = [
            'source $__fish_data_dir/config.fish --help',
          ].join('\n');
          const { rootNode } = parser.parse(source);
          const foundNodes = getChildNodes(rootNode).filter(n => isSourcedFilename(n));
          expect(foundNodes.length).toBe(1);
          foundNodes.forEach(n => {
            expect(isExistingSourceFilenameNode(n)).toBeTruthy();
          });
        });
      });

      describe('command syntax using dot: `. some_file`', () => {
        it('Does not exist', () => {
          const source = '. __file_does_not_exist.fish';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n))!;
          expect(foundNode).toBeDefined();
          expect(foundNode.text).toBe('__file_does_not_exist.fish');
          expect(isExistingSourceFilenameNode(foundNode)).toBeFalsy();
        });

        it('Does exist', () => {
          const source = '. $__fish_data_dir/config.fish';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n))!;
          expect(foundNode).toBeDefined();
          expect(SyncFileHelper.expandEnvVars(foundNode.text).startsWith('$')).toBeFalsy();
          expect(isExistingSourceFilenameNode(foundNode)).toBeTruthy();
        });

        it('Multiple arguments to source file', () => {
          const source = [
            '. $__fish_data_dir/config.fish --help',
          ].join('\n');
          const { rootNode } = parser.parse(source);
          const foundNodes = getChildNodes(rootNode).filter(n => isSourcedFilename(n));
          expect(foundNodes.length).toBe(1);
          foundNodes.forEach(n => {
            expect(isExistingSourceFilenameNode(n)).toBeTruthy();
          });
        });
      });

      describe('pipe to source', () => {
        it("echo 'complete -c foo -e' | source", () => {
          const source = 'echo \'complete -c foo -e\' | source';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n));
          expect(foundNode).toBeUndefined();
        });
      });

      describe('source with redirection', () => {
        it('source foo.fish > /dev/null', () => {
          const source = 'source foo.fish > /dev/null';
          const { rootNode } = parser.parse(source);
          const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n));
          expect(foundNode).toBeDefined();
          expect(foundNode!.text).toBe('foo.fish');
        });
      });

      describe('find all sourced filepaths', () => {
        it('5 source commands, 3 filepaths', () => {
          const source = [
            'source $__fish_data_dir/config.fish --help',
            '. $__fish_data_dir/config.fish --help',
            'source $__fish_data_dir/config.fish > /dev/null',
            'thefuck --alias | source',
            'echo "complete -c foo -e" | source',
          ].join('\n');
          const { rootNode } = parser.parse(source);
          const sourceCommands = getChildNodes(rootNode).filter(n => isSourceCommandName(n));
          expect(sourceCommands.length).toBe(5);
          const sourcedFilenames = getChildNodes(rootNode).filter(n => isSourcedFilename(n));
          expect(sourcedFilenames).toHaveLength(3);
        });
      });
    });

    describe('getExpandedSourcedFilenameNode()', () => {
      it('source $__fish_data_dir/config.fish', () => {
        const source = 'source $__fish_data_dir/config.fish';
        const { rootNode } = parser.parse(source);
        const foundNode = getChildNodes(rootNode).find(n => isSourcedFilename(n))!;
        const expanded = getExpandedSourcedFilenameNode(foundNode);
        expect(expanded).toBeDefined();
      });

      it('for file in $HOME/.config/fish/config.fish; source $file; end', () => {
        const source = [
          'for file in $HOME/.config/fish/config.fish',
          '    source $file',
          '    source boo.fish',
          '    source ~/__foo.fish',
          '    source $__fish_data_dir/config.fish',
          '    source $__fish_data_dir/baz.fish',
          '    source $HOME/.config/fish/config.fish',
          'end'].join('\n');
        const { rootNode } = parser.parse(source);
        const foundNodes = getChildNodes(rootNode).filter(n => isSourceCommandArgumentName(n))!;
        const diagnosticNodes = [
          'boo.fish',
          '~/__foo.fish',
          '$__fish_data_dir/baz.fish',
        ];
        const notDiagnosticNodes = [
          '$file',
          '$HOME/.config/fish/config.fish',
          '$__fish_data_dir/config.fish',
        ];
        foundNodes.forEach(n => {
          const isDiagnostic = Diagnostics.isSourceFilename(n);
          if (diagnosticNodes.includes(n.text)) {
            expect(isDiagnostic).toBeTruthy();
          } else if (notDiagnosticNodes.includes(n.text)) {
            expect(isDiagnostic).toBeFalsy();
          }
        });
      });
    });
  });

  describe('completion <--> argparse locations', () => {
    describe('find completions in a document', () => {
      it('`functions/foo.fish` | `foo --help | foo -h`', () => {
        const input = [
          'function foo',
          '    argparse -i h/help -- $argv',
          '    or return',
          '    echo hi',
          'end',
        ].join('\n');
        const document = createFakeLspDocument('functions/foo.fish', input);
        const { rootNode } = parser.parse(input);
        const symbols = flattenNested(...processNestedTree(document, rootNode));
        const opts = symbols.filter(symbol => symbol.fishKind === 'ARGPARSE');
        console.log({
          opts: opts.map(o => o.name),
        });
      });

      it('`completions/foo.fish', () => {
        const input = [
          'complete -c foo -f',
          'complete -c foo -s h -l help',
        ].join('\n');
        const document = createFakeLspDocument('completions/foo.fish', input);
        expect(document).toBeDefined();
        const { rootNode } = parser.parse(input);
        const matches: string[] = [];
        const completeCommands = getChildNodes(rootNode).filter(n => isCompletionDefinition(n));
        for (const completeCommand of completeCommands) {
          const completionSymbol = processCompletion(document, completeCommand);
          const firstItem = completionSymbol.pop();
          if (firstItem?.hasShortOptions()) {
            firstItem.getFlags().short.forEach(o => {
              matches.push(o.value.text);
            });
          }
          if (firstItem?.hasLongOptions()) {
            firstItem.getFlags().long.forEach(o => {
              matches.push(o.value.text);
            });
          }
        }
        expect(matches.length).toBe(2);
      });
    });

    describe('compare symbols to completions', () => {
      const inputs = [
        {
          uri: 'functions/foo.fish',
          source: [
            'function foo',
            '    argparse -i h/help -- $argv',
            '    or return',
            '    echo hi',
            'end',
          ].join('\n'),

        },
        {
          uri: 'completions/foo.fish',
          source: [
            'complete -c foo -f',
            'complete -c foo -s h -l help',
          ].join('\n'),
        },
      ];
      it("compare `foo _flag_h/_flag_help` to `h/help' `{functions,completions}/foo.fish`", () => {
        analyzer = new Analyzer(parser);
        const documents = inputs.map(({ uri, source }) => {
          const document = createFakeLspDocument(uri, source);
          analyzer.analyze(document);
          return document;
        });
        const completionDoc = documents.find(d => d.uri.endsWith('completions/foo.fish'))!;
        const functionDoc = documents.find(d => d.uri.endsWith('functions/foo.fish'))!;
        // console.log({
        //   completionDoc: completionDoc.uri,
        //   functionDoc: functionDoc.uri,
        // });
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        const argparseSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri)
          .filter(sym => sym.fishKind === 'ARGPARSE');
        const completionSymbols = analyzer.getFlatCompletionSymbols(completionDoc.uri);
        expect(completionSymbols.length).toBe(2);
        argparseSymbols.map((symbol) => {
          const document = analyzer.getDocument(symbol.uri);
          if (document && document.getAutoloadType() === 'functions') {
            const equalCompletionSymbol = completionSymbols.find(completionSymbol => {
              return completionSymbol.equalsFishSymbol(symbol);
            });
            expect(equalCompletionSymbol).toBeDefined();
            return;
          }
          fail();
        });
      });

      it('compare using `getGlobalArgparseLocations()`', async () => {
        // setup the analyzer
        analyzer = new Analyzer(parser);
        // setup the documents
        const documents = inputs.map(({ uri, source }) => {
          const document = createFakeLspDocument(uri, source);
          analyzer.analyze(document);
          return document;
        });
        // get the documents so testing is easier
        const completionDoc = documents.find(d => d.uri.endsWith('completions/foo.fish'))!;
        const functionDoc = documents.find(d => d.uri.endsWith('functions/foo.fish'))!;
        const argparseSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri)
          .filter(sym => sym.fishKind === 'ARGPARSE');

        const workspace = await Workspace.createFromUri(completionDoc.getFilePath()!);
        if (!workspace) fail();
        workspaces.push(workspace);

        // console.log({
        //   workspaces: workspaces.length,
        // })

        // check that the argparse symbols are are defined in both files
        argparseSymbols.forEach(symbol => {
          console.log({
            symbol: {
              name: symbol.name,
              kind: symbol.fishKind,
              uri: symbol.uri,
            },
            'isGlobalArgparseDefinition(analyzer, functionDoc, symbol)': isGlobalArgparseDefinition(analyzer, functionDoc, symbol),
            'getGlobalArgparseLocations(analyzer, functionDoc, symbol)': getGlobalArgparseLocations(analyzer, functionDoc, symbol),
            completionDoc: completionDoc.uri,
            functionDoc: functionDoc.uri,
            workspace: workspace.uri,
          });
          const locations = getGlobalArgparseLocations(analyzer, functionDoc, symbol);
          expect(locations.length).toBe(1);
          const completionSymbol = locations[0];
          expect(completionSymbol).toBeDefined();
          if (!completionSymbol) fail();
          expect(completionSymbol.uri).toBe(completionDoc.uri);
          const equalCompletionSymbol = completionSymbol.uri !== functionDoc.uri;
          expect(equalCompletionSymbol).toBeTruthy();
        });
      });
    });
    describe.only('completion --> to argparse', () => {
      let workspace: LspDocument[] = [];
      beforeEach(async () => {
        parser = await initializeParser();
        analyzer = new Analyzer(parser);
        workspace = createTestWorkspace(analyzer,
          {
            path: 'functions/foo.fish',
            text: [
              'function foo',
              '    argparse -i h/help long other-long s \'1\' -- $argv',
              '    or return',
              '    echo hi',
              'end',
            ].join('\n'),
          },
          {
            path: 'completions/foo.fish',
            text: [
              'complete -c foo -f -k',
              'complete -c foo -s h -l help',
              'complete -c foo -k -l long',
              'complete -c foo -k -l other-long -d \'other long\'',
              'complete -c foo -k -s s -d \'short\'',
              'complete -c foo -k -s 1 -d \'1 item\'',
            ].join('\n'),
          });
      });

      it('completion >>(((*> function', () => {
        const resultOptions: VerboseCompletionSymbol[] = [];
        const resultArgparse: FishSymbol[] = [];
        workspace.forEach(doc => {
          console.log(doc.uri);
          if (doc.isFunction()) {
            const symbolTree = processNestedTree(doc, analyzer.getRootNode(doc.uri)!);
            const flatTree = flattenNested(...symbolTree);
            resultArgparse.push(...flatTree);
          }
          analyzer.getNodes(doc.uri).forEach(node => {
            const cmpSymbol = isCompletionSymbolVerbose(node);
            if (cmpSymbol.isNonEmpty()) {
              resultOptions.push(cmpSymbol);
            }
          });
        });
        for (const cmpSymbol of resultOptions) {
          const found = resultOptions.find(o => cmpSymbol.isCorrespondingOption(o));
          if (!found) continue;
          expect(found.node?.text === 'h' || found.node?.text === 'help').toBeTruthy();
          console.log({
            cmpSymbol: cmpSymbol.toUsage(),
            found: found?.toUsage(),
          });
        }
        groupVerboseCompletionSymbolsTogether(...resultOptions).forEach((group, idx) => {
          group.forEach(symbol => {
            console.log(idx, {
              text: symbol.text,
              symbol: symbol.toUsage(),
            });
          });
        });
        // there is only one pair: `-h`/`--help`
        expect(groupVerboseCompletionSymbolsTogether(...resultOptions)).toHaveLength(5);

        // make _flag_h/_flag_help === -h/--help ...
        for (const argSymbol of resultArgparse.filter(arg => arg.fishKind === 'ARGPARSE')) {
          const foundOption = resultOptions.find(o => o.equalsArgparse(argSymbol));
          if (!foundOption) continue;
          console.log({
            found: foundOption.toUsage(),
            flag: argSymbol.argparseFlagName,
            argparseLength: argSymbol.argparseFlagName.length,
            argparseParent: argSymbol.parent?.name,
            argSymbol: argSymbol.name,
          });
        }
      });
    });
  });
});

/////////////////////////////////////////////////////////////////////////
// mini testing Option arrays
/////////////////////////////////////////////////////////////////////////
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
