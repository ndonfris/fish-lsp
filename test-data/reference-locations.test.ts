import * as os from 'os';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { execCommandLocations } from '../src/utils/exec';
import { currentWorkspace, findCurrentWorkspace, workspaces } from '../src/utils/workspace';
import { createFakeLspDocument, createTestWorkspace, setLogger } from './helpers';
import { getRange } from '../src/utils/tree-sitter';
import { isMatchingOption, Option } from '../src/parsing/options';
import { isCompletionDefinition, isCompletionDefinitionWithName, isCompletionSymbol } from '../src/parsing/complete';
import { isCommandWithName, isOption } from '../src/utils/node-types';
import { getArgparseDefinitionName, getGlobalArgparseLocations, isArgparseVariableDefinitionName } from '../src/parsing/argparse';
import { getArgparseLocations, getReferences } from '../src/references';
import { Position } from 'vscode-languageserver';

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
        console.log('location', {
          uri: def.toLocation().uri,
          rangeStart: def.toLocation().range.start,
          rangeEnd: def.toLocation().range.end,
        });
        others.forEach(loc => {
          console.log('location', {
            uri: loc.uri,
            rangeStart: loc.range.start,
            rangeEnd: loc.range.end,
          });
        });
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
});
