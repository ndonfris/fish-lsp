import * as os from 'os';
import * as Parser from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { execCommandLocations } from '../src/utils/exec';
// import { currentWorkspace, findCurrentWorkspace, workspaces } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { createFakeLspDocument, createTestWorkspace, setLogger } from './helpers';
import { getRange } from '../src/utils/tree-sitter';
import { isMatchingOption, Option } from '../src/parsing/options';
import { isCompletionCommandDefinition, isCompletionDefinitionWithName, isCompletionSymbol } from '../src/parsing/complete';
import { isCommandWithName, isOption } from '../src/utils/node-types';
import { getGlobalArgparseLocations, isArgparseVariableDefinitionName } from '../src/parsing/argparse';
import { getReferences } from '../src/references';

let parser: Parser;
// let currentWorkspace: CurrentWorkspace = new CurrentWorkspace();

describe('find definition locations of symbols', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    await Analyzer.initialize();
  });

  afterEach(() => {
    parser.delete();
    workspaceManager.clear();
  });

  describe('find analyzed symbol location', () => {
    it('should find symbol location', async () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  echo "hello"',
            'end',
          ],
        },
        {
          path: 'functions/test2.fish',
          text: [
            'function test2',
            '  echo "hello"',
            'end',
          ],
        },
      );
      const doc = documents.at(0)!;
      const symbols = analyzer.getFlatDocumentSymbols(doc.uri);
      expect(symbols).toHaveLength(2);
    });

    it('should find test location', () => {
      const documents = createTestWorkspace(
        analyzer,
        {
          path: 'functions/test.fish',
          text: [
            'function test',
            '  echo "hello"',
            'end',
          ],
        },
        {
          path: 'functions/test2.fish',
          text: [
            'function test2',
            '  echo "hello"',
            'end',
          ],
        },
        {
          path: 'functions/test3.fish',
          text: [
            'function test3',
            '  test',
            'end',
          ],
        },
      );
      expect(documents).toHaveLength(3);
      const doc = documents.at(-1)!;
      const nodes = analyzer.getNodes(doc.uri);
      const node = nodes.find((n) => n.type === 'command' && n.text === 'test')!;
      // console.log('node', {
      //   text: node?.text,
      //   type: node?.type,
      //   start: getRange(node).start,
      //   end: getRange(node).end,
      // });
      const defLocations = analyzer.getDefinitionLocation(doc, getRange(node).start);
      expect(defLocations).toHaveLength(1);
      const def = defLocations.at(0)!;
      // console.log('def', {
      //   uri: def?.uri,
      //   range: def?.range,
      // });
      expect(def.uri).toBe(documents.at(0)!.uri);
      expect(def.range.start.line).toBe(0);
      expect(def.range.start.character).toBe(9);
      expect(def.range.end.line).toBe(0);
      expect(def.range.end.character).toBe(13);
    });

    it('should find completion location', () => {
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
      );
      expect(documents).toHaveLength(2);
      const functionDoc = documents.at(0)!;
      const completionDoc = documents.at(1)!;
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      const functionSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri);
      expect(functionSymbols).toHaveLength(13);
      const completionSymbols = analyzer.getFlatCompletionSymbols(completionDoc.uri);
      // expect(completionSymbols).toHaveLength(6);
      const searchNode = analyzer.getNodes(completionDoc.uri).find(n => isCompletionSymbol(n) && n.text === 'help');
      const result = analyzer.getDefinitionLocation(completionDoc, getRange(searchNode!).start);
      const resultUri = result[0]?.uri;
      // console.log({
      //   uri: result[0]?.uri,
      //   range: result[0]?.range,
      // })
      if (!resultUri) {
        console.log('resultUri is undefined');
        fail();
        return;
      }
      expect(result).toHaveLength(1);
      expect(resultUri).toBe(functionDoc.uri);
    });

    it.skip('should find --flag-name location', () => {
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
      const completionNode = analyzer.findNode((n, doc) => {
        if (doc?.uri === completionDoc.uri && n.parent && isCompletionCommandDefinition(n.parent)) {
          return n.text === 'yes';
        }
        return false;
      });
      const funcNode = analyzer.findNode((n, doc) => {
        if (doc?.uri === functionDoc.uri && isArgparseVariableDefinitionName(n) && n.text.includes('yes')) {
          return true;
        }
        return false;
      });

      console.log('testNode', {
        uri: confdDoc.uri,
        line: 1,
        character: 10,
        node: nodeAtPoint?.type,
        text: nodeAtPoint?.text,
      },
      'completionNode',
      {
        uri: completionDoc.uri,
        line: completionNode!.startPosition.row,
        character: completionNode!.startPosition.column,
        node: completionNode!.type,
        text: completionNode!.text,
      },
      'funcNode',
      {
        uri: functionDoc.uri,
        line: funcNode!.startPosition.row,
        character: funcNode!.startPosition.column,
        node: funcNode!.type,
        text: funcNode!.text,
      },
      );
      if (nodeAtPoint && isOption(nodeAtPoint)) {
        const result = getReferences(analyzer, confdDoc, getRange(nodeAtPoint).start);
        result.forEach(loc => {
          console.log('location', {
            uri: loc.uri,
            range: loc.range.start,
          });
        });
        expect(result).toHaveLength(4);
        const symbol = analyzer.findSymbol((s) => {
          if (s.parent && s.fishKind === 'ARGPARSE') {
            return nodeAtPoint.parent?.firstNamedChild?.text === s.parent?.name &&
              s.parent?.isGlobal() &&
              nodeAtPoint.text.startsWith(s.argparseFlag);
          }
          return false;
        });
        // console.log({
        //   symbol: symbol?.name,
        //   uri: symbol?.uri,
        //   range: symbol?.selectionRange,
        // });

        if (!symbol) {
          console.log('symbol not found');
          return;
        }
        const parentName = symbol.parent?.name || '';
        const matchingNodes = analyzer.findNodes((n, document) => {
          // complete -c parentName -s ... -l flag-name
          if (
            isCompletionDefinitionWithName(n, parentName, document!)
            && n.text === symbol.argparseFlagName
          ) {
            return true;
          }
          // parentName --flag-name
          if (
            n.parent
            && isCommandWithName(n.parent, parentName)
            && isOption(n)
            && isMatchingOption(n, Option.fromRaw(symbol?.argparseFlag))
          ) {
            return true;
          }
          // _flag_name in scope
          if (
            document!.uri === symbol.uri
            && symbol.scopeContainsNode(n)
            && n.text === symbol.name
          ) {
            return true;
          }
          return false;
        });
        for (const { uri, nodes } of matchingNodes) {
          console.log(`nodes ${uri}`);
          console.log(nodes.map(n => n.text));
        }
        // const completionNodes = getGlobalArgparseLocations(analyzer, functionDoc, symbol);
        // for (const { uri, range } of completionNodes) {
        //   console.log(`completion ${uri}`);
        //   console.log(range);
        // }
        expect(true).toBeTruthy();
      }
      // const functionSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri);
      // const completionSymbols = analyzer.getFlatCompletionSymbols(completionDoc.uri);
      // const confdNodes = analyzer.findNodes((n) => {
      //   if (n.parent && isCommandWithName(n.parent, 'test') && isOption(n) && isMatchingOption(n, Option.create('-y', '--yes'))) {
      //     return true;
      //   }
      //   return false;
      // });
      // for (const { uri, nodes } of confdNodes) {
      //   console.log(`confd ${uri}`);
      //   console.log(nodes.map(n => n.text));
      // }
    });
  });

  describe.skip('update currentWorkspace.current workspace', () => {
    it('should update currentWorkspace', async () => {
      [
        createFakeLspDocument('functions/test.fish',
          'function test',
          '  echo "hello"',
          'end',
        ),
        createFakeLspDocument('functions/test2.fish',
          'function test2',
          '  echo "hello"',
          'end',
        ),
      ].forEach(async (doc) => {
        const newWorkspace = workspaceManager.findContainingWorkspace(doc.uri);
        expect(newWorkspace).toBeDefined();
        workspaceManager.handleOpenDocument(doc);
      });

      expect(workspaceManager.current).toBeDefined();
      expect(workspaceManager.current?.path).toBe(`${os.homedir()}/.config/fish`);
      expect(workspaceManager.current?.getUris()).toHaveLength(1);
    });
  });

  describe('finding global command\'s location path', () => {
    it('`fish_add_path` -> valid', async () => {
      const cmd = 'fish_add_path';
      const locations = execCommandLocations(cmd);
      expect(locations).toHaveLength(1);
    });
    it('`source` -> INVALID', async () => {
      const cmd = 'source';
      const locations = execCommandLocations(cmd);
      expect(locations).toHaveLength(0);
    });

    it('`alias` -> valid', () => {
      const cmd = 'alias';
      const locations = execCommandLocations(cmd);
      expect(locations).toHaveLength(1);
      const { uri, path } = locations.at(0)!;
      // console.log({ uri, path })
      expect(uri).toBeDefined();
      expect(path).toBeDefined();
      expect(path.endsWith('alias.fish')).toBeTruthy();
      expect(uri.endsWith('alias.fish')).toBeTruthy();
    });
  });
});

