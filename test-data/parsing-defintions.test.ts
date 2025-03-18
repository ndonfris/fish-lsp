import { Parsers, Option } from '../src/parsing/barrel';
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
import { isCommandWithName, isFunctionDefinition } from '../src/utils/node-types';

let parser: Parser;

describe('parsing symbols', () => {
  setLogger();
  beforeEach(async () => {
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
          console.log('missing:', flag);
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
      const foundNode = getChildNodes(rootNode).find(Parsers.argparse.isArgparseDefinition);
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
