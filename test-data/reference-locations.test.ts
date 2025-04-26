import * as Parser from 'web-tree-sitter';
import { AnalyzedDocument, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { workspaces } from '../src/utils/workspace';
import { createFakeLspDocument, createTestWorkspace, setLogger } from './helpers';
import { getChildNodes, getRange } from '../src/utils/tree-sitter';
import { isCompletionDefinition } from '../src/parsing/complete';
import { isOption } from '../src/utils/node-types';
import { getArgparseDefinitionName, isCompletionArgparseFlagWithCommandName } from '../src/parsing/argparse';
import { getRenames } from '../src/renames';
import { getArgparseLocations, getReferences } from '../src/references';
import { Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../src/document';

let parser: Parser;
let analyzer: Analyzer;
// let currentWorkspace: CurrentWorkspace = new CurrentWorkspace();

describe('find definition locations of symbols', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  afterEach(() => {
    parser.delete();
    analyzer = new Analyzer(parser);
    for (const ws of workspaces) {
      ws.uris.clear();
      workspaces.pop();
    }
  });

  describe('argparse', () => {
    it('`{functions,completions,conf.d}/test.fish`', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
            '  or return',
            '  if set -lq _flag_help',
            '      echo "help_msg"',
            '  end',
            '  if set -lq _flag_name && test -n "$_flag_name"',
            '      echo "$_flag_name"',
            '  end',
            '  if set -lq _flag_quiet',
            '      echo "quiet"',
            '  end',
            '  if set -lq _flag_version',
            '      echo "1.0.0"',
            '  end',
            '  if set -lq _flag_yes',
            '      echo "yes"',
            '  end',
            '  if set -lq _flag_no',
            '      echo "no"',
            '  end',
            '  echo $argv',
            'end',
          ],
        },
        {
          path: 'completions/test.fish',
          text: [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   test --yes',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      const completionDoc = documents.at(1)!;
      const confdDoc = documents.at(2)!;
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      expect(confdDoc).toBeDefined();
      const nodeAtPoint = analyzer.nodeAtPoint(confdDoc.uri, 1, 10);
      if (nodeAtPoint && isOption(nodeAtPoint)) {
        const result = getReferences(analyzer, confdDoc, getRange(nodeAtPoint).start);
        // result.forEach(loc => {
        //   console.log('location', {
        //     uri: loc.uri,
        //     rangeStart: loc.range.start,
        //     rangeEnd: loc.range.end,
        //   });
        // });
        expect(result).toHaveLength(4);
      }
    });

    it('test _flag_help', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
            '  or return',
            '  if set -lq _flag_help',
            '      echo "help_msg"',
            '  end',
            '  if set -lq _flag_name && test -n "$_flag_name"',
            '      echo "$_flag_name"',
            '  end',
            '  if set -lq _flag_quiet',
            '      echo "quiet"',
            '  end',
            '  if set -lq _flag_version',
            '      echo "1.0.0"',
            '  end',
            '  if set -lq _flag_yes',
            '      echo "yes"',
            '  end',
            '  if set -lq _flag_no',
            '      echo "no"',
            '  end',
            '  echo $argv',
            'end',
          ],
        },
        {
          path: 'completions/test.fish',
          text: [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   test --yes',
            'end',
          ],
        },
      );

      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      expect(functionDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === '_flag_help';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(analyzer, functionDoc, getRange(found).start);
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // });
      expect(result).toHaveLength(3);
    });

    it('test _flag_version', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
            '  or return',
            '  if set -lq _flag_help',
            '      echo "help_msg"',
            '  end',
            '  if set -lq _flag_name && test -n "$_flag_name"',
            '      echo "$_flag_name"',
            '  end',
            '  if set -lq _flag_quiet',
            '      echo "quiet"',
            '  end',
            '  if set -lq _flag_version',
            '      echo "1.0.0"',
            '  end',
            '  if set -lq _flag_yes',
            '      echo "yes"',
            '  end',
            '  if set -lq _flag_no',
            '      echo "no"',
            '  end',
            '  echo $argv',
            'end',
          ],
        },
        {
          path: 'completions/test.fish',
          text: [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   test --yes',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      const completionDoc = documents.at(1)!;
      const confdDoc = documents.at(2)!;
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      expect(confdDoc).toBeDefined();
      const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 52)!;
      // console.log({
      //   nodeAtPoint,
      //   uri: confdDoc.uri,
      //   text: nodeAtPoint?.text,
      // });
      expect(nodeAtPoint!.text).toBe('v/version');
      const refs = getReferences(analyzer, functionDoc, Position.create(1, 52));
      // refs.forEach(loc => {
      //   console.log('location ref', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // });
      expect(refs).toHaveLength(3);
    });

    it.only('complete -c test -s h -l help', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
            '  or return',
            '  if set -lq _flag_help',
            '      echo "help_msg"',
            '  end',
            '  if set -lq _flag_name && test -n "$_flag_name"',
            '      echo "$_flag_name"',
            '  end',
            '  if set -lq _flag_quiet',
            '      echo "quiet"',
            '  end',
            '  if set -lq _flag_version',
            '      echo "1.0.0"',
            '  end',
            '  if set -lq _flag_yes',
            '      echo "yes"',
            '  end',
            '  if set -lq _flag_no',
            '      echo "no"',
            '  end',
            '  echo $argv',
            'end',
          ],
        },
        {
          path: 'completions/test.fish',
          text: [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   test --yes',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      const completionDoc = documents.at(1)!;
      const confdDoc = documents.at(2)!;
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      expect(confdDoc).toBeDefined();
      const nodeAtPoint = analyzer.nodeAtPoint(completionDoc.uri, 0, 27)!;
      expect(nodeAtPoint).toBeDefined();
      // console.log({
      //   // nodeAtPoint,
      //   uri: completionDoc.uri,
      //   text: nodeAtPoint?.text,
      // })
      expect(nodeAtPoint!.text).toBe('help');
      if (nodeAtPoint.parent && isCompletionDefinition(nodeAtPoint.parent)) {
        const def = analyzer.findSymbol((s, document) => {
          return functionDoc.uri === document!.uri && s.name === getArgparseDefinitionName(nodeAtPoint);
        })!;
        const others = getArgparseLocations(analyzer, def);
        // console.log('location', {
        //   uri: def.toLocation().uri,
        //   rangeStart: def.toLocation().range.start,
        //   rangeEnd: def.toLocation().range.end,
        // });
        // others.forEach(loc => {
        //   console.log('location', {
        //     uri: loc.uri,
        //     rangeStart: loc.range.start,
        //     rangeEnd: loc.range.end,
        //   });
        // });
        // console.log('def', {
        //   uri: def.uri,
        //   rangeStart: def.range.start,
        //   rangeEnd: def.range.end,
        // })
        expect(def).toBeDefined();
      }
      const refs = getReferences(analyzer, completionDoc, Position.create(0, 27));
      // refs.forEach(loc => {
      //   console.log('location ref', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // });
      expect(refs).toHaveLength(3);
    });
  });

  describe('set', () => {
    it('foo local', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'conf.d/_foo.fish',
          text: [
            'function test',
            '  set -lx foo bar',
            '  echo $foo',
            'end',
            'test',
          ],
        },
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '    set -lx foo bar',
            'end',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   set -x foo bar',
            'end',
            'function next',
            '   set foo bar',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      expect(functionDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(analyzer, functionDoc, getRange(found).start);
      expect(result).toHaveLength(2);
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // });
    });
    it('foo global', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'conf.d/_foo.fish',
          text: [
            'function test',
            '  set -gx foo bar',
            '  echo $foo',
            'end',
            'test',
          ],
        },
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '    set -lx foo bar',
            'end',
          ],
        },
        {
          path: 'conf.d/test.fish',
          text: [
            'function __test',
            '   set -x foo bar',
            'end',
            'function next',
            '   set foo bar',
            'end',
            'echo $foo',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const functionDoc = documents.at(0)!;
      expect(functionDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(analyzer, functionDoc, getRange(found).start);
      expect(result).toHaveLength(3);
      //
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // })
    });
  });

  describe('alias', () => {
    it('global alias', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'conf.d/alias.fish',
          text: [
            'alias ls=\'exa\'',
          ],
        },
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '    set -lx foo bar',
            '    function ls',
            '          builtin ls',
            '    end',
            '    ls',
            'end',
          ],
        },
        {
          path: 'functions/test-other.fish',
          text: [
            'function test-other',
            '    ls $argv',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const searchDoc = documents.at(0)!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      // console.log('found', {
      //   uri: searchDoc.uri,
      //   rangeStart: getRange(found).start,
      //   rangeEnd: getRange(found).end,
      // });
      const result = getReferences(analyzer, searchDoc, getRange(found).start);
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // })
      expect(result).toHaveLength(2);
    });

    it('local alias', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'conf.d/alias.fish',
          text: [
            'function foo',
            '    alias ls=\'exa\'',
            'end',
          ],
        },
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '    set -lx foo bar',
            '    function ls',
            '          builtin ls',
            '    end',
            '    ls',
            'end',
          ],
        },
        {
          path: 'functions/test-other.fish',
          text: [
            'function test-other',
            '    ls $argv',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const searchDoc = documents.at(0)!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      // console.log('found', {
      //   uri: searchDoc.uri,
      //   rangeStart: getRange(found).start,
      //   rangeEnd: getRange(found).end,
      // });
      const result = getReferences(analyzer, searchDoc, getRange(found).start);
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // })
      expect(result).toHaveLength(1);
    });
  });

  describe('functions', () => {
    it('conf.d/foo.fish ->  foo function definition', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'conf.d/foo.fish',
          text: [
            'function foo',
            '    echo \'hello there!\'',
            'end',
          ],
        },
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '    foo --help',
            'end',
          ],
        },
        {
          path: 'functions/test-other.fish',
          text: [
            'function test-other',
            '    function foo',
            '         echo \'general kenobi!\'',
            '    end',
            '    foo',
            'end',
          ],
        },
        {
          path: 'completions/foo.fish',
          text: [
            'complete -c foo -n \'test\' -s h -l help',
          ],
        },
      );
      expect(documents).toHaveLength(4);
      const searchDoc = documents.at(0)!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      // console.log('found', {
      //   uri: searchDoc.uri,
      //   rangeStart: getRange(found).start,
      //   rangeEnd: getRange(found).end,
      // });
      const result = getReferences(analyzer, searchDoc, getRange(found).start);
      // result.forEach(loc => {
      //   console.log('location', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //   });
      // });
      expect(result).toHaveLength(3);
    });
  });

  describe('renames', () => {
    describe('using `conf.d/test.fish` document', () => {
      const document = createFakeLspDocument(
        'conf.d/test.fish',
        'function test_1',
        '    argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
        '    or return',
        '    if set -lq _flag_help',
        '        echo "help_msg"',
        '    end',
        '    if set -lq _flag_name && test -n "$_flag_name"',
        '        echo "$_flag_name"',
        '    end',
        'end',
        'function test_2',
        '     test_1 --help',
        'end',
        'complete -c test_1 -s h -l help',
        'complete -c test_1      -l name',
        'complete -c test_1 -s q -l quiet',
        'complete -c test_1 -s v -l version',
        'complete -c test_1 -s y -l yes',
      );

      let cached: AnalyzedDocument;
      beforeEach(() => {
        cached = analyzer.analyze(document);
      });

      it('child completion nodes', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        console.log(nodeAtPoint?.text);
        expect(nodeAtPoint).toBeDefined();
        const results: SyntaxNode[] = [];
        getChildNodes(cached.tree.rootNode).forEach(node => {
          if (
            isCompletionArgparseFlagWithCommandName(node, 'test_1', 'help') ||
            isCompletionArgparseFlagWithCommandName(node, 'test_1', 'h')
          ) {
            results.push(node);
          }
        });
        expect(results).toHaveLength(2);
      });

      it('argparse references for `h/help` position inside of `help`', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        console.log(nodeAtPoint?.text);
        expect(nodeAtPoint).toBeDefined();
        const refs = getReferences(analyzer, cached.document, Position.create(1, 31));
        const resultTexts: string[] = [];
        refs.forEach(loc => {
          if (analyzer.getTextAtLocation(loc).startsWith('_flag_')) {
            loc.range.start.character += '_flag_'.length;
          }
          // console.log('location ref', {
          //   uri: loc.uri,
          //   rangeStart: loc.range.start,
          //   rangeEnd: loc.range.end,
          //   text: analyzer.getTextAtLocation(loc),
          // });
          resultTexts.push(analyzer.getTextAtLocation(loc));
        });
        expect(resultTexts).toHaveLength(4);
        for (const text of resultTexts) {
          if (text !== 'help') fail();
        }
      });
    });

    describe.only('using \'{completions,functions,conf.d}/test.fish\' workspace', () => {
      let documents: LspDocument[] = [];
      let functionDoc: LspDocument;
      let completionDoc: LspDocument;
      let confdDoc: LspDocument;
      let configDoc: LspDocument;

      beforeEach(async () => {
        documents = createTestWorkspace(
          analyzer,
          {
            path: 'functions/foo_test.fish',
            text: [
              'function foo_test',
              '  argparse --stop-nonopt special-option h/help name= q/quiet v/version y/yes n/no -- $argv',
              '  or return',
              '  if set -lq _flag_help',
              '      echo "help_msg"',
              '  end',
              '  if set -lq _flag_name && test -n "$_flag_name"',
              '      echo "$_flag_name"',
              '  end',
              '  if set -lq _flag_special_option',
              '      echo "special-option"',
              '  end',
              'end',
            ],
          },
          {
            path: 'completions/foo_test.fish',
            text: [
              'complete -c foo_test -s h -l help',
              'complete -c foo_test      -l name',
              'complete -c foo_test -s q -l quiet',
              'complete -c foo_test -s v -l version',
              'complete -c foo_test -s y -l yes',
              'complete -c foo_test -s n -l no',
              'complete -c foo_test -l special-option',
            ],
          },
          {
            path: 'conf.d/__test.fish',
            text: [
              'function __test',
              '   foo_test --yes',
              '   foo_test --special-option',
              'end',
            ],
          },
          {
            path: 'config.fish',
            text: [
              'set -gx FISH_TEST_CONFIG "test"',
              'set -gx FISH_TEST_CONFIG_2 "test"',
              'function foo_test_wrapper -w foo_test -d "`foo_test --yes` wrapper"',
              '   foo_test --yes $argv',
              '   foo_test --special-option="$argv"',
              'end',
            ],
          },
        );
        documents.forEach(doc => {
          analyzer.analyze(doc);
        });
        functionDoc = documents.at(0)!;
        completionDoc = documents.at(1)!;
        confdDoc = documents.at(2)!;
        configDoc = documents.at(3)!;
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        expect(confdDoc).toBeDefined();
        expect(configDoc).toBeDefined();
      });

      it('argparse rename `name=` -> `na` test', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 34);
        expect(nodeAtPoint).toBeDefined();
        // console.log(1, nodeAtPoint?.text);
        const refs = getRenames(analyzer, functionDoc, Position.create(1, 34), 'na');
        const newTexts: Set<string> = new Set();
        refs.forEach(loc => {
          newTexts.add(loc.newText);
        });
        expect(refs).toHaveLength(5);
        expect(newTexts.size === 1).toBeTruthy();
      });

      //   console.log('location ref', {
      //     uri: loc.uri,
      //     rangeStart: loc.range.start,
      //     rangeEnd: loc.range.end,
      //     // text: analyzer.getTextAtLocation(loc),
      //     newText: loc.newText
      //   });

      it('argparse `name=` test', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 47);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('name=');
        console.log(2, nodeAtPoint?.text);
        const refs = getRenames(analyzer, functionDoc, Position.create(1, 47), 'special-name');
        const newTexts: Set<string> = new Set();
        refs.forEach(loc => {
          newTexts.add(loc.newText);
        });
        expect(refs).toHaveLength(5);
        expect(newTexts.size === 2).toBeTruthy();
        expect(newTexts.has('special-name')).toBeTruthy();
        expect(newTexts.has('special_name')).toBeTruthy();
      });

      it('function `foo_test`', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 0, 11);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('foo_test');
        const refs = getRenames(analyzer, functionDoc, Position.create(0, 11), 'test-rename');
        const newTexts: Set<string> = new Set();
        const refUris: Set<string> = new Set();
        const countPerUri: Map<string, number> = new Map();
        refs.forEach(loc => {
          // console.log('location ref', {
          //   uri: loc.uri,
          //   rangeStart: loc.range.start,
          //   rangeEnd: loc.range.end,
          //   text: loc.newText,
          // });
          const count = countPerUri.get(loc.uri) || 0;
          countPerUri.set(loc.uri, count + 1);
          newTexts.add(loc.newText);
          refUris.add(loc.uri);
        });
        expect(newTexts.size === 1).toBeTruthy();
        expect(refs).toHaveLength(13);
        expect(refUris.size).toBe(4);
        expect(countPerUri.get(functionDoc.uri)).toBe(1);
        expect(countPerUri.get(completionDoc.uri)).toBe(7);
        expect(countPerUri.get(confdDoc.uri)).toBe(2);
        expect(countPerUri.get(configDoc.uri)).toBe(3);
      });
    });
  });
});

