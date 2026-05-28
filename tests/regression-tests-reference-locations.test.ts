import { analyzer, Analyzer } from '../src/analyze';
import { workspaceManager } from '../src/utils/workspace-manager';
import { createFakeLspDocument, locationAsString, printClientTree, printLocations, rangeAsString, setLogger, matchLocation, toMatchLocations, expectFoundLocationsToEqualMatchLocations, debugMatchLocations, compareFoundLocationsToMatchLocations } from './helpers';
import { getChildNodes, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { isCompletionCommandDefinition } from '../src/parsing/complete';
import { isArgumentThatCanContainCommandCalls, isCommand, isCommandWithName, isDefinitionName, isEndStdinCharacter, isOption, isString, isVariable, isVariableDefinitionName } from '../src/utils/node-types';
import { getArgparseDefinitionName, isCompletionArgparseFlagWithCommandName } from '../src/parsing/argparse';
import { getRenames } from '../src/renames';
import { Position, Location } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../src/document';
import { filterFirstPerScopeSymbol } from '../src/parsing/symbol';
import { isMatchingOptionValue } from '../src/parsing/options';
import { Option } from '../src/parsing/options';
import { extractCommands, extractMatchingCommandLocations } from '../src/parsing/nested-strings';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import TestWorkspace from './test-workspace-utils';
import { logger } from '../src/logger';
import { fail } from 'assert';
import { FishReferenceCandidate } from '../src/parsing/reference-candidates';

beforeAll(() => {
  logger.setSilent(false);
});
afterAll(() => {
  logger.setSilent(true);
});

function getNodeOrPostion(arg: SyntaxNode | Position): Position {
  if (Position.is(arg)) {
    return arg;
  }
  return getRange(arg).start;
}

type CompareReferencesOpts = {
  excludeDefinition?: boolean;
  localOnly?: boolean;
};

function compareReferences(
  doc: LspDocument,
  pos: Position | SyntaxNode,
  expectedLength?: number,
  opts: CompareReferencesOpts = {},
) {
  const position = getNodeOrPostion(pos);
  const refs = analyzer.getReferences(doc, position, {
    includeDefinitions: !opts.excludeDefinition,
    localOnly: opts.localOnly,
  });
  if (expectedLength !== undefined) {
    expect(refs).toHaveLength(expectedLength);
  }
}

function compareUnusedReferences(
  doc: LspDocument,
  expectedLength?: number,
  expectedNames?: string[],
) {
  const unused = analyzer.allUnusedLocalReferences(doc);
  if (expectedLength !== undefined) {
    expect(unused).toHaveLength(expectedLength);
  }
  if (expectedNames !== undefined) {
    expect(unused.map(s => s.name).sort()).toEqual([...expectedNames].sort());
  }
}

describe('find reference locations of symbols', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('argparse', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/test.fish',
        content: [
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
        ].join('\n'),
      },
      {
        relativePath: 'completions/test.fish',
        content: [
          'complete -c test -s h -l help',
          'complete -c test      -l name',
          'complete -c test -s q -l quiet',
          'complete -c test -s v -l version',
          'complete -c test -s y -l yes',
          'complete -c test -s n -l no',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/test.fish',
        content: [
          'function __test',
          '   test --yes',
          'end',
          'complete -c __test -l yes',
        ].join('\n'),
      },
    ).initialize();

    it('`{functions,completions,conf.d}/test.fish`', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const completionDoc = workspace.getDocument('completions/test.fish')!;
      const confdDoc = workspace.getDocument('conf.d/test.fish')!;
      expect(workspace.documents).toHaveLength(3);
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      expect(confdDoc).toBeDefined();
      const nodeAtPoint = analyzer.nodeAtPoint(confdDoc.uri, 1, 10);
      if (nodeAtPoint && isOption(nodeAtPoint)) {
        // const result = analyzer.getReferences(confdDoc, getRange(nodeAtPoint).start);
        // expect(result).toHaveLength(4);
        compareReferences(confdDoc, nodeAtPoint, 4);
      }
    });

    it('test _flag_yes', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === '_flag_yes';
      })!;
      expect(found).toBeDefined();
      const result = analyzer.getReferences(functionDoc, getRange(found).start);
      const foundSymbol = analyzer.getDefinition(functionDoc, getRange(found).start);
      console.log(foundSymbol?.toString());
      const sorter = FishReferenceCandidate.comparatorForSymbol(foundSymbol!);
      const result2 = [
        FishReferenceCandidate.fromSymbol(foundSymbol!),
        ...analyzer.referenceCandidates.findForSymbol(foundSymbol!).filter(rc => foundSymbol?.isReference(rc.document, rc.node, true)),
      ].sort(sorter);
      const result3 = analyzer.getReferences(functionDoc, getRange(found).start, {
        includeDefinitions: true,
      });
      console.log(analyzer.getReferences(functionDoc, getRange(found).start));
      // const result2 = analyzer.referenceCandidates.find(found.text);
      // analyzer.symbols.allSymbolsByName.find('_flag_yes').forEach(s => {
      //   console.log({
      //     symbolName: s.name,
      //     symbolKind: s.kind,
      //   })
      // })
      // analyzer.referenceCandidates.findInDocument(functionDoc!.uri, '_flag_yes').forEach(({ node, document }) => {
      //     console.log({
      //       nodeText: node.text,
      //       nodeType: node.type,
      //       documentUri: document?.uri,
      //     })
      // })
      console.log({
        result: result.map(loc => locationAsString(loc)),
        // result2: result2.map(({ node, document }) => ({
        //   text: node.text,
        //   uri: LspDocument.testUri(document.uri),
        result2: result2.map((item) => {
          const { document, name, node, range } = item;
          return {
            uri: LspDocument.testUri(document.uri),
            name: name,
            node: node.text,
            range: rangeAsString(range),
            loc: locationAsString(item.toLocation()),
          };
        }),
        result3: result3.map(loc => locationAsString(loc)),
      });

      compareReferences(functionDoc!, found, 4);
      expect(result).toHaveLength(4);
    });

    it('test _flag_version', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 52)!;
      expect(nodeAtPoint!.text).toBe('v/version');
      const refs = analyzer.getReferences(functionDoc, Position.create(1, 52));
      compareReferences(functionDoc, Position.create(1, 52), 3);
      expect(refs).toHaveLength(3);
    });

    it('complete -c test -s h -l help', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const completionDoc = workspace.getDocument('completions/test.fish')!;
      const nodeAtPoint = analyzer.nodeAtPoint(completionDoc.uri, 0, 27)!;
      expect(nodeAtPoint).toBeDefined();
      expect(nodeAtPoint!.text).toBe('help');
      if (nodeAtPoint.parent && isCompletionCommandDefinition(nodeAtPoint.parent)) {
        const def = analyzer.findSymbol((s, document) => {
          return functionDoc.uri === document!.uri && s.name === getArgparseDefinitionName(nodeAtPoint);
        })!;
        expect(def).toBeDefined();
      }
      const refs = analyzer.getReferences(completionDoc, Position.create(0, 27));
      // const newRefs = analyzer.getReferences(completionDoc, Position.create(0, 27));
      compareReferences(completionDoc, Position.create(0, 27), 3);
      expect(refs).toHaveLength(3);
      // expect(refs).toEqual(newRefs);
    });

    // Regression: a `cmd --flag` call inside a non-autoloaded script must still
    // resolve to the argparse flag symbol owned by the function defined earlier
    // in the same document — the autoload gate in getDefinition was too strict.
    describe('non-autoloaded script', () => {
      const scriptWorkspace = TestWorkspace.create().addFiles({
        relativePath: 'example.fish',
        content: [
          'function greet -d "Greet someone by name"',
          "    argparse 'n/name' -- $argv",
          '    or return 1',
          '',
          '    not set -ql _flag_name',
          '    and set _flag_name "world"',
          '',
          '    echo "Hello, $_flag_name!"',
          'end',
          '',
          'greet --name "fish-lsp user"',
        ].join('\n'),
      }).initialize();

      it('function opt: `greet --name` reference to argparse `n/name`', () => {
        const doc = scriptWorkspace.getDocument('example.fish')!;

        // Locate `--name` at the call site on the last line.
        const callSiteNode = analyzer.getNodes(doc.uri).find(n =>
          n.text === '--name' && isOption(n) && n.startPosition.row === 10,
        )!;
        expect(callSiteNode).toBeDefined();
        const callSitePos = getRange(callSiteNode).start;

        const matchLocations = [
          matchLocation('example.fish', 1, 16),
          matchLocation('example.fish', 4, 16),
          matchLocation('example.fish', 5, 12),
          matchLocation('example.fish', 7, 18),
          matchLocation('example.fish', 10, 8),
        ];

        // go-to-definition should land on the argparse `name` symbol declared
        // by `argparse 'n/name'` inside `greet` (line 1).
        const def = analyzer.getDefinition(doc, callSitePos);
        expect(def).toBeDefined();
        expect(def!.fishKind).toBe('ARGPARSE');
        expect(def!.argparseFlagName).toBe('name');
        expect(def!.selectionRange.start.line).toBe(1);

        const defLoc = def!.toLocation();
        const matchDefLoc = matchLocations.at(0)!;

        expectFoundLocationsToEqualMatchLocations(
          [defLoc],
          [matchDefLoc],
        );

        // find-references should include: the argparse def, the `_flag_name`
        // uses inside the function body, and the call site `--name` itself.
        const refs = analyzer.getReferences(doc, callSitePos);
        // refsViaReferencesTs.forEach(loc => {
        //   console.log(["matchLocation('example.fish'", loc.range.start.line, loc.range.start.character+')', ''].join(', '))
        // })
        const refLines = new Set(refs.map(loc => loc.range.start.line));
        expect(refLines.has(1)).toBeTruthy();
        expect(refLines.has(10)).toBeTruthy();

        // compareFoundLocationsToMatchLocations(refs, matchLocations);
        expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
        expect(refs).toHaveLength(matchLocations.length);
        compareReferences(doc, callSitePos, matchLocations.length);
      });
    });
  });

  describe('set', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'conf.d/_foo.fish',
        content: [
          'function test',
          '  set -lx foo bar',
          '  echo $foo',
          'end',
          'test',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test.fish',
        content: [
          'function test',
          '    set -lx foo bar',
          '    set -ql foo',
          '    if test -n "$foo"',
          '        set foo bar2',
          '        echo $foo',
          '    end',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/test.fish',
        content: [
          'function __test',
          '   set -x foo bar',
          'end',
          'function next',
          '   set foo bar',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/global_test.fish',
        content: [
          'set -gx foo bar',
          'echo $foo',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test-other.fish',
        content: [
          'function test-other',
          '    echo $foo',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('foo local in conf.d/_foo.fish `2 refs for \'foo\'`', () => {
      const confdDoc = workspace.getDocument('conf.d/_foo.fish')!;
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      expect(workspace.documents).toHaveLength(5);
      expect(functionDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === confdDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = analyzer.getReferences(confdDoc, getRange(found).start);
      // printLocations(result, {
      //   showLineText: true,
      // });
      compareReferences(confdDoc, found, 2);
      expect(result).toHaveLength(2);
    });

    it('foo local in functions/test.fish `5 refs for \'foo\'`', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const node = analyzer.getNodes(functionDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      expect(node).toBeDefined();
      const def = analyzer.getDefinition(functionDoc, getRange(node).start);
      // console.log({def:locationAsString(def?.toLocation()!)});
      const result = analyzer.getReferences(functionDoc, getRange(node).start);
      // printLocations(result, {
      //   showText: true,
      //   showLineText: true,
      //   showIndex: true,
      //   rangeVerbose: true,
      // });
      // for (const loc of result) {
      //   console.log({
      //     uri: LspDocument.testUri(loc.uri),
      //     text: analyzer.getTextAtLocation(loc),
      //     node: analyzer.nodeAtPoint(loc.uri, loc.range.start.line, loc.range.start.character)?.text,
      //     symbol: analyzer.getFlatDocumentSymbols(loc.uri).find(s => s.equalsLocation(loc))?.toString(),
      //   });
      // }
      compareReferences(functionDoc, node, 5);
      expect(result).toHaveLength(5);
    });

    it('foo global', () => {
      const globalTestDoc = workspace.getDocument('conf.d/global_test.fish')!;
      const node = analyzer.getNodes(globalTestDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      console.log(globalTestDoc.getText());

      expect(node).toBeDefined();
      const result = analyzer.getReferences(globalTestDoc, getRange(node).start);
      printLocations(result, {
        showText: true,
        showLineText: true,
      });
      compareReferences(globalTestDoc, node, 3);
      expect(result).toHaveLength(3);
      expect(result.map(loc => loc.uri).some(uri => uri.includes('functions/test-other.fish'))).toBeTruthy();
      expect(result.map(loc => loc.uri).some(uri => uri.includes('conf.d/global_test.fish'))).toBeTruthy();
    });
  });

  describe('variable reference edge cases', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'conf.d/variable-reference-edge-cases.fish',
        content: [
          'set bar baz',
          'bar',
          '$bar',
          'set -q bar',
          'set -e bar[1]',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/variable-reference-lifetime.fish',
        content: [
          'set -g some_var "active"',
          'echo $some_var',
          'set -eg some_var',
          'echo $some_var',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/prebuilt-set-reference-targets.fish',
        content: [
          'set -q PATH',
          'set -e PATH[1]',
          'echo $PATH',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/guarded-set-query-reference.fish',
        content: [
          'set -qg EDITOR || set -g EDITOR nvim',
          'set -q VISUAL || set VISUAL nvim',
          'function local_guard',
          '  set -q LOCAL_EDITOR || set -l LOCAL_EDITOR nvim',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('does not treat bare command names as variable references', () => {
      const doc = workspace.getDocument('conf.d/variable-reference-edge-cases.fish')!;
      const definitionNode = analyzer.getNodes(doc.uri).find(n =>
        n.text === 'bar' && isVariableDefinitionName(n),
      )!;
      expect(definitionNode).toBeDefined();

      const refs = analyzer.getReferences(doc, getRange(definitionNode).start);
      const refLines = new Set(refs.map(loc => loc.range.start.line));

      compareReferences(doc, definitionNode, 4);
      expect(refLines.has(1)).toBeFalsy();
    });

    it('includes $bar and set -q/-e targets as variable references', () => {
      const doc = workspace.getDocument('conf.d/variable-reference-edge-cases.fish')!;
      const definitionNode = analyzer.getNodes(doc.uri).find(n =>
        n.text === 'bar' && isVariableDefinitionName(n),
      )!;
      expect(definitionNode).toBeDefined();

      const refs = analyzer.getReferences(doc, getRange(definitionNode).start);
      const refLines = new Set(refs.map(loc => loc.range.start.line));

      expect(refs).toHaveLength(4);
      expect(refLines.has(0)).toBeTruthy();
      expect(refLines.has(2)).toBeTruthy();
      expect(refLines.has(3)).toBeTruthy();
      expect(refLines.has(4)).toBeTruthy();
      compareReferences(doc, definitionNode, 4);
    });

    it('set -eg should end global variable lifetime for later references', () => {
      const doc = workspace.getDocument('conf.d/variable-reference-lifetime.fish')!;

      const defNode = analyzer.getNodes(doc.uri).find((n) =>
        n.startPosition.row === 0 && n.text === 'some_var' && isVariableDefinitionName(n),
      );
      expect(defNode).toBeDefined();

      const refs = analyzer.getReferences(doc, getRange(defNode!).start);
      const refLines = new Set(refs.map(loc => loc.range.start.line));

      expect(refLines.has(0)).toBeTruthy();
      expect(refLines.has(1)).toBeTruthy();
      expect(refLines.has(2)).toBeTruthy();
      expect(refLines.has(3)).toBeFalsy();
      compareReferences(doc, defNode!, refs.length);
    });

    it('includes set -q/-e targets when finding prebuilt PATH references', () => {
      const doc = workspace.getDocument('conf.d/prebuilt-set-reference-targets.fish')!;
      const queryPathNode = analyzer.getNodes(doc.uri).find((n) =>
        n.startPosition.row === 0 && n.text === 'PATH',
      );
      expect(queryPathNode).toBeDefined();

      const refs = analyzer.getReferences(doc, getRange(queryPathNode!).start);
      const refLines = new Set(refs.map(loc => loc.range.start.line));

      expect(refs).toHaveLength(3);
      expect(refLines.has(0)).toBeTruthy();
      expect(refLines.has(1)).toBeTruthy();
      expect(refLines.has(2)).toBeTruthy();
      compareReferences(doc, queryPathNode!, 3);
    });

    it('includes guarded set -q targets for matching global scopes, but not local pre-definition scopes', () => {
      const doc = workspace.getDocument('conf.d/guarded-set-query-reference.fish')!;
      const nodes = analyzer.getNodes(doc.uri);

      const editorDef = nodes.find((n) =>
        n.startPosition.row === 0 && n.text === 'EDITOR' && isVariableDefinitionName(n),
      );
      const visualDef = nodes.find((n) =>
        n.startPosition.row === 1 && n.text === 'VISUAL' && isVariableDefinitionName(n),
      );
      const localDef = nodes.find((n) =>
        n.startPosition.row === 3 && n.text === 'LOCAL_EDITOR' && isVariableDefinitionName(n),
      );

      expect(editorDef).toBeDefined();
      expect(visualDef).toBeDefined();
      expect(localDef).toBeDefined();

      const editorRefs = analyzer.getReferences(doc, getRange(editorDef!).start);
      const visualRefs = analyzer.getReferences(doc, getRange(visualDef!).start);
      const localRefs = analyzer.getReferences(doc, getRange(localDef!).start);

      const erefs = analyzer.getReferences(doc, getRange(editorDef!).start);
      const o_localRefs = analyzer.getReferences(doc, getRange(localDef!).start, {
        includeDefinitions: false,
      });

      console.log({
        editorRefs: editorRefs.map(loc => locationAsString(loc)),
        erefs: erefs.map(loc => locationAsString(loc)),
        pos: rangeAsString(getRange(editorDef!)),
        o_localRefs: o_localRefs.map(loc => locationAsString(loc)),
      });
      expect(editorRefs).toHaveLength(2);
      expect(editorRefs.some(loc =>
        loc.range.start.line === 0
        && loc.range.start.character < getRange(editorDef!).start.character,
      )).toBeTruthy();

      expect(visualRefs).toHaveLength(2);
      expect(visualRefs.some(loc =>
        loc.range.start.line === 1
        && loc.range.start.character < getRange(visualDef!).start.character,
      )).toBeTruthy();

      // expect(o_localRefs).toHaveLength(1);
      expect(localRefs).toHaveLength(1);
      expect(localRefs.some(loc =>
        loc.range.start.line === 3
        && loc.range.start.character < getRange(localDef!).start.character,
      )).toBeFalsy();
      compareReferences(doc, editorDef!, editorRefs.length);
      compareReferences(doc, visualDef!, visualRefs.length);
      compareReferences(doc, localDef!, localRefs.length);
    });
  });

  describe('alias', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'conf.d/alias.fish',
        content: [
          'alias ls=\'exa\'',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test.fish',
        content: [
          'function test',
          '    set -lx foo bar',
          '    function ls',
          '          command exa $argv',
          '    end',
          '    ls',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test-other.fish',
        content: [
          'function test-other',
          '    ls $argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'completions/ls-wrapper.fish',
        content: [
          'complete -c ls-wrapper -w \'ls\'',
        ].join('\n'),
      },
      {
        relativePath: 'completions/ls.fish',
        content: [
          'complete -c ls -n \'command -aq ls\'',
        ].join('\n'),
      },
      {
        relativePath: 'functions/ls-wrapper.fish',
        content: [
          'function ls-wrapper -w=ls --wraps \'command ls\'',
          '    argparse -n=ls h/help -- $argv; or return 1',
          '    echo "ls-wrapper"',
          '    ls $argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/user_keybinds.fish',
        content: [
          'function user_keybinds',
          '    bind ctro-o,ctrl-l \'ls\'',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/abbrevaitons.fish',
        content: [
          'abbr -a ll ls -l',
          'abbr -a lt -- ls -t',
          'abbr -a --command=ls lt -- -lt',
        ].join('\n'),
      },
      {
        relativePath: 'functions/local-alias.fish',
        content: [
          'function local-alias',
          '    alias ls=\'ls-wrapper\'',
          '    ls $argv',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('check seen -w/--wraps nodes', () => {
      const values = analyzer.findNodes((n, _) => {
        return isMatchingOptionValue(n, Option.create('-w', '--wraps').withValue());
      }).flatMap(({ nodes }) => nodes);
      expect(values).toHaveLength(3);
    });

    it('check all strings that should be a function call location', () => {
      const symbol = analyzer.findSymbol((s, d) => {
        return !!(s.name === 'ls' && d?.uri.endsWith('conf.d/alias.fish'));
      })!;

      const commandCalls = analyzer.findNodes((n, d) => {
        if (symbol.equalsNode(n, { strict: true })) {
          console.log({
            symbol: symbol.toString(),
            node: n.text,
            uri: d?.uri,
            range: getRange(n),
          });
        }
        const flatSymbols = analyzer.getFlatDocumentSymbols(d.uri).filter(s =>
          s.isLocal()
          && s.name === symbol.name
          && s.kind === symbol.kind,
        );

        if (flatSymbols && flatSymbols.some(s => s.scopeContainsNode(n))) {
          return false;
        }

        if (
          n.parent
          && isCommandWithName(n.parent, symbol.name)
          && n.parent.firstNamedChild?.equals(n)
        ) {
          return true;
        }

        if (isArgumentThatCanContainCommandCalls(n)) {
          if (isString(n) || n.text.includes('=')) {
            return extractCommands(n).some(cmd => cmd === symbol.name);
          }
          return n.text === symbol.name;
        }

        if (isDefinitionName(n)) return false;

        if (n.parent && isCommandWithName(n.parent, 'functions', 'emit', 'trap', 'command', 'bind', 'abbr')) {
          if (n.parent.firstNamedChild?.equals(n)) return false;
          if (isOption(n)) return false;
          if (isString(n)) return extractCommands(n).some(cmd => cmd === symbol.name);
          const firstIndex = isCommandWithName(n.parent, 'bind', 'abbr') ? 2 : 1;
          const endStdinIndex = isCommandWithName(n.parent, 'abbr')
            ? -1
            : n.parent.children.findIndex(c => isEndStdinCharacter(c));
          const children = n.parent.children.slice(firstIndex, endStdinIndex).filter(c => !isOption(c) && !isEndStdinCharacter(c));
          const found = children.find(n => n.text === symbol.name);
          if (found) {
            return found.equals(n);
          }
        }

        return false;
      });
      commandCalls.forEach(({ uri, nodes }, index) => {
        console.log(`commandCall ${index}`, {
          uri: LspDocument.testUri(uri),
          nodes: nodes.map(n => ({
            text: n.text,
            type: n.type,
            startPosition: `{ row: ${n.startPosition.row}, column: ${n.startPosition.column} }`,
            endPosition: `{ row: ${n.endPosition.row}, column: ${n.endPosition.column} }`,
          })),
        });
      });
    });

    it('global alias `ls` (using cache via `getReferences()`)', () => {
      const searchDoc = workspace.getDocument('conf.d/alias.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text.startsWith('ls');
      })!;
      expect(found).toBeDefined();
      const matchLocations = [
        matchLocation('conf.d/alias.fish', 0, 6),
        matchLocation('functions/test-other.fish', 1, 5),
        matchLocation('completions/ls.fish', 0, 13),
        // matchLocation('completions/ls.fish', 0, 31), // missing?
        matchLocation('completions/ls-wrapper.fish', 0, 28), // missing?
        matchLocation('functions/ls-wrapper.fish', 0, 24),
        // matchLocation('functions/ls-wrapper.fish', 0, 44), // missing?
        matchLocation('functions/ls-wrapper.fish', 1, 17),
        matchLocation('functions/ls-wrapper.fish', 3, 5),
        matchLocation('functions/user_keybinds.fish', 1, 24),
        matchLocation('conf.d/abbrevaitons.fish', 0, 12),
        matchLocation('conf.d/abbrevaitons.fish', 1, 15),
        matchLocation('conf.d/abbrevaitons.fish', 2, 18),
      ];
      debugMatchLocations(matchLocations, workspace, {
        showDocs: true,
        separator: true,
      });
      const refs = analyzer.getReferences(searchDoc, getRange(found).start, {
        includeDefinitions: true,
      });
      // matchLocations.forEach((ml, index) => {
      //   const doc = workspace.getDocument(ml.uri)
      //   if (!refs.some(loc => ml.equalsLocation(loc))) {
      //     console.log('-'.repeat(80))
      //     console.log(`MatchLocation ${index} did not have a corresponding reference location!\n`, {
      //       matchLocation: locationAsString(Location.create(ml.uri, { start: ml.position, end: ml.position })),
      //     })
      //     console.log(doc?.getText());
      //     console.log('-'.repeat(80))
      //   }
      // })
      compareFoundLocationsToMatchLocations(refs, matchLocations);
      expect(refs).toHaveLength(matchLocations.length);
      compareReferences(searchDoc, found, matchLocations.length);
    });

    it.skip('global alias `ls` (iter approach **OLD**)', () => {
      const searchDoc = workspace.getDocument('conf.d/alias.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      const symbol = analyzer.findSymbol((s, _) => {
        if (s.fishKind === 'ALIAS') {
          return s.name === 'ls' && s.uri === searchDoc.uri;
        }
        return false;
      })!;

      analyzer.symbols.allSymbolsByName.find('ls').forEach(s => {
        console.log({
          allSymbolsByName: 'ls',
          name: s.name,
          kind: s.kind,
          fishKind: s.fishKind,
          uri: s.uri,
        });
      });
      analyzer.referenceCandidates.find('ls').forEach(({ node, document }) => {
        console.log({
          'referenceCandidate node': node.text,
          nodeText: node.text,
          nodeType: node.type,
          documentUri: document?.uri,
        });
      });
      workspace.documents.forEach((doc, i) => {
        console.log('-'.repeat(80));
        console.log(`FILE ${i}: ${doc.getRelativeFilenameToWorkspace()}`);
        console.log(doc.getText());
        console.log('-'.repeat(80));
      });
      const refNodes = analyzer.findNodes((n, d) => {
        // return isCommandWithName(n, searchSymbol.name);
        // return isArgumentThatCanContainCommandCalls(n)
        // if (isCommandName(n)) {
        if (symbol.equalsNode(n, { strict: true })) {
          console.log({
            symbol: symbol.toString(),
            node: n.text,
            uri: d?.uri,
            range: getRange(n),
          });
        }
        const flatSymbols = analyzer.getFlatDocumentSymbols(d.uri).filter(s =>
          s.isLocal()
          && s.name === symbol.name
          && s.kind === symbol.kind,
        );

        if (flatSymbols && flatSymbols.some(s => s.scopeContainsNode(n))) {
          return false;
        }

        if (
          n.parent
          && isCommandWithName(n.parent, symbol.name)
          && n.parent.firstNamedChild?.equals(n)
        ) {
          return true;
        }

        if (isArgumentThatCanContainCommandCalls(n)) {
          if (isString(n) || n.text.includes('=')) {
            return extractCommands(n).some(cmd => cmd === symbol.name);
          }
          return n.text === symbol.name;
        }

        if (isDefinitionName(n)) return false;

        if (n.parent && isCommandWithName(n.parent, 'functions', 'emit', 'trap', 'command')) {
          if (n.parent.firstNamedChild?.equals(n)) return false;
          if (isOption(n)) return false;
          if (isString(n)) return extractCommands(n).some(cmd => cmd === symbol.name);
          return n.parent.children.slice(1).find(n => !isOption(n))?.text === symbol.name;
        }

        return false;
      });

      let i = 0;
      const results: Location[] = [];
      for (const { uri, nodes } of refNodes) {
        console.log(`refNode ${i++}`, {
          uri,
          nodes: nodes.map(n => ({
            text: n.text,
            type: n.type,
            startPosition: `{ row: ${n.startPosition.row}, column: ${n.startPosition.column} }`,
            endPosition: `{ row: ${n.endPosition.row}, column: ${n.endPosition.column} }`,
          })),
        });
        nodes.forEach(n => {
          if (n.text !== symbol.name) {
            const newLocations = extractMatchingCommandLocations(symbol, n, uri);
            results.push(...newLocations);
          } else {
            results.push(Location.create(uri, getRange(n)));
          }
        });
      }
      const builtinRefs = analyzer.getReferences(searchDoc, getRange(found).start, {
        includeDefinitions: true,
      });
      console.log('builtinRefs', builtinRefs.length);
      printLocations(builtinRefs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(builtinRefs).toHaveLength(12);
      compareReferences(searchDoc, found!, 12);
    });

    it('local alias', () => {
      const searchDoc = workspace.getDocument('functions/local-alias.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      console.log(searchDoc.getText());
      const result = analyzer.getReferences(searchDoc, getRange(found).start);
      expect(result).toHaveLength(2);
      compareReferences(searchDoc, found, 2);
    });
  });

  describe('functions', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'conf.d/foo.fish',
        content: [
          'function foo',
          '    echo \'hello there!\'',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test.fish',
        content: [
          'function test',
          '    foo --help',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/test-other.fish',
        content: [
          'function test-other',
          '    function foo',
          '         echo \'general kenobi!\'',
          '    end',
          '    foo',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'completions/foo.fish',
        content: [
          'complete -c foo -n \'test\' -s h -l help',
        ].join('\n'),
      },
    ).initialize();

    it('conf.d/foo.fish ->  foo function definition', () => {
      expect(workspace.documents).toHaveLength(4);
      const searchDoc = workspace.getDocument('conf.d/foo.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = analyzer.getReferences(searchDoc, getRange(found).start);
      expect(result).toHaveLength(3);
      const uris = new Set(result.map(loc => LspDocument.createFromUri(loc.uri).getRelativeFilenameToWorkspace()));
      console.log(uris);
      expect(uris.has('functions/test.fish')).toBeTruthy();
      expect(uris.has('functions/test-other.fish')).toBeFalsy();
      expect(uris.has('completions/foo.fish')).toBeTruthy();
      expect(uris.has('conf.d/foo.fish')).toBeTruthy();
      compareReferences(searchDoc, found, 3);
    });
  });

  describe('renames', () => {
    describe('using `conf.d/test.fish` document', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/test.fish',
          content: ['function test_1',
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
          ].join('\n'),
        },
      ).initialize();

      it('child completion nodes', () => {
        const document = workspace.getDocument('conf.d/test.fish')!;
        const cached = analyzer.analyze(document).ensureParsed();
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
        compareReferences(document, nodeAtPoint!, 2);
      });

      it('argparse references for `h/help` position inside of `help`', () => {
        const document = workspace.getDocument('conf.d/test.fish')!;
        const cached = analyzer.analyze(document).ensureParsed();
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        console.log(nodeAtPoint?.text);
        expect(nodeAtPoint).toBeDefined();
        const refs = analyzer.getReferences(cached.document, Position.create(1, 31));
        const resultTexts: string[] = [];
        refs.forEach(loc => {
          if (analyzer.getTextAtLocation(loc).startsWith('_flag_')) {
            loc.range.start.character += '_flag_'.length;
          }
          resultTexts.push(analyzer.getTextAtLocation(loc));
        });
        expect(resultTexts).toHaveLength(4);
        for (const text of resultTexts) {
          if (text !== 'help') fail();
        }
        compareReferences(cached.document, Position.create(1, 31), 4);
      });
    });

    describe('using \'workspaces/test_renames_workspace/{completions,functions,conf.d}/**.fish\' workspace', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'functions/foo_test.fish',
          content: [
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
          ].join('\n'),
        },
        {
          relativePath: 'completions/foo_test.fish',
          content: [
            'complete -c foo_test -s h -l help',
            'complete -c foo_test      -l name',
            'complete -c foo_test -s q -l quiet',
            'complete -c foo_test -s v -l version',
            'complete -c foo_test -s y -l yes',
            'complete -c foo_test -s n -l no',
            'complete -c foo_test -l special-option',
          ].join('\n'),
        },
        {
          relativePath: 'conf.d/__test.fish',
          content: [
            'function __test',
            '   foo_test --yes',
            '   foo_test --special-option',
            '   baz',
            'end',
          ].join('\n'),
        },
        {
          relativePath: 'config.fish',
          content: [
            'set -gx FISH_TEST_CONFIG "test"',
            'set -gx FISH_TEST_CONFIG_2 "test"',
            'function foo_test_wrapper -w foo_test -d "`foo_test --yes` wrapper"',
            '   foo_test --yes $argv',
            '   foo_test --special-option="$argv"',
            'end',
            "alias baz='foo'",
          ].join('\n'),
        },
      ).initialize();

      it('setup test', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const completionDoc = workspace.getDocument('completions/foo_test.fish')!;
        const confdDoc = workspace.getDocument('conf.d/__test.fish')!;
        const configDoc = workspace.getDocument('config.fish')!;
        expect(workspaceManager.current?.uris.indexed).toHaveLength(4);
        expect(workspaceManager.current?.uris.all).toHaveLength(4);
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        expect(confdDoc).toBeDefined();
        expect(configDoc).toBeDefined();
      });

      it('argparse rename `name=` -> `na` test', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 49)!;
        expect(nodeAtPoint).toBeDefined();
        console.debug(1, nodeAtPoint?.text);
        const defSymbol = analyzer.getDefinition(functionDoc, Position.create(1, 49));
        const refs = analyzer.getReferences(functionDoc, Position.create(1, 49));
        console.log('def', {
          defSymbol,
          uri: defSymbol?.uri,
          rangeStart: defSymbol?.selectionRange.start,
          rangeEnd: defSymbol?.selectionRange.end,
          text: defSymbol?.name,
        });
        printLocations(refs, {
          verbose: true,
        });

        const renames = getRenames(functionDoc, Position.create(1, 49), 'na');
        const newTexts: Set<string> = new Set();
        renames.forEach(loc => {
          newTexts.add(loc.newText);
        });
        expect(refs).toHaveLength(5);
        expect(newTexts.size === 1).toBeTruthy();
        compareReferences(functionDoc, Position.create(1, 49), 5);
      });

      it('argparse `special-option` test', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 27);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('special-option');
        console.log(2, nodeAtPoint?.text);
        const renames = getRenames(functionDoc, Position.create(1, 27), 'special-name');
        const newTexts: Set<string> = new Set();
        const uris: Set<string> = new Set();
        renames.forEach(loc => {
          uris.add(loc.uri);
          newTexts.add(loc.newText);
        });
        expect(renames).toHaveLength(5);
        expect(newTexts.size === 2).toBeTruthy();
        expect(newTexts.has('special-name')).toBeTruthy();
        expect(newTexts.has('special_name')).toBeTruthy();
        expect(uris.size).toBe(4);
      });

      it('function `foo_test`', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const completionDoc = workspace.getDocument('completions/foo_test.fish')!;
        const confdDoc = workspace.getDocument('conf.d/__test.fish')!;
        const configDoc = workspace.getDocument('config.fish')!;
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 0, 11);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('foo_test');
        const refs = getRenames(functionDoc, Position.create(0, 11), 'test-rename');
        const newTexts: Set<string> = new Set();
        const refUris: Set<string> = new Set();
        const countPerUri: Map<string, number> = new Map();
        refs.forEach(loc => {
          console.log('location ref', {
            uri: loc.uri,
            rangeStart: loc.range.start,
            rangeEnd: loc.range.end,
            docText: analyzer.getTextAtLocation(loc),
            docLine: analyzer.getDocument(loc.uri)!.getLine(loc.range.start.line),
            text: loc.newText,
          });
          const count = countPerUri.get(loc.uri) || 0;
          countPerUri.set(loc.uri, count + 1);
          newTexts.add(loc.newText);
          refUris.add(loc.uri);
        });
        expect(newTexts.size === 1).toBeTruthy();
        // expect(refs).toHaveLength(13);
        expect(refUris.size).toBe(4);
        expect(countPerUri.get(functionDoc.uri)).toBe(1);
        expect(countPerUri.get(completionDoc.uri)).toBe(7);
        expect(countPerUri.get(confdDoc.uri)).toBe(2);
        expect(countPerUri.get(configDoc.uri)).toBe(3);
      });

      it('function `foo_test` with precomputed cross-file references', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const refs = analyzer.getReferences(functionDoc, Position.create(0, 11));
        const renames = getRenames(functionDoc, Position.create(0, 11), 'test-rename', {
          references: refs,
        });

        const refUris = new Set(renames.map(loc => loc.uri));
        expect(renames).toHaveLength(refs.length);
        expect(refUris.size).toBe(4);
        compareReferences(functionDoc, Position.create(0, 11), refs.length);
      });

      it('config.fish $argv rename', () => {
        const configDoc = workspace.getDocument('config.fish')!;
        const argvNode = analyzer.getNodes(configDoc.uri)
          .find(n => n.text === '$argv' && n.parent && isCommand(n.parent))!;
        console.log({
          argvNode: {
            text: argvNode.text,
            type: argvNode.type,
            startPosition: argvNode.startPosition,
            endPosition: argvNode.endPosition,
          },
          parent: {
            type: argvNode.parent?.type,
            text: argvNode.parent?.text,
          },
          uri: configDoc.uri,
        });
        const pos = pointToPosition(argvNode!.startPosition);
        const renames = getRenames(configDoc, pos, 'test-argv');
        expect(renames.length === 0).toBeTruthy();
      });

      it('alias `baz` references && renames', () => {
        const configDoc = workspace.getDocument('config.fish')!;
        const bazNode = analyzer.getFlatDocumentSymbols(configDoc.uri)
          .find(s => s.name === 'baz' && s.fishKind === 'ALIAS')!;
        console.log({
          bazNode: {
            name: bazNode.name,
            uri: bazNode.uri,
            range: bazNode.range,
            selectionRange: bazNode.selectionRange,
          },
        });
        const bazLocation = bazNode.toLocation();
        const refs = analyzer.getReferences(configDoc, bazLocation.range.start);
        const renames = getRenames(configDoc, bazLocation.range.start, 'baz_test');
        expect(refs).toHaveLength(2);
        expect(renames).toHaveLength(2);
        compareReferences(configDoc, bazLocation.range.start, 2);
      });
    });
  });

  describe('references to skip', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/_test.fish',
        content: [
          'function _test',
          '  set -l argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'config.fish',
        content: [
          'test -d ~/.config/fish &>/dev/null',
          'echo $status',
          'echo $argv',
          'echo $argv[1]',
          'echo $pipestatus',
        ].join('\n'),
      },
    ).initialize();

    it('variables to skip test', () => {
      const configDoc = workspace.getDocument('config.fish')!;
      const variableNodes = analyzer.getNodes(configDoc.uri).filter(
        n => isVariable(n) && n.type === 'variable_name',
      );
      expect(variableNodes.length).toBe(4);
      // Prebuilt variables (status, argv, pipestatus) now correctly return
      // references via the prebuilt variable fallback, so they will have ≥1 ref
      variableNodes.forEach(node => {
        const refs = analyzer.getReferences(configDoc, getRange(node).start);
        expect(refs.length).toBeGreaterThanOrEqual(1);
        compareReferences(configDoc, node, refs.length);
      });
    });

    it('function `test` -> `argv` references w/ `set -l argv`', () => {
      const funcDoc = workspace.getDocument('functions/_test.fish')!;
      const variableNode = analyzer.getNodes(funcDoc.uri).find(
        n => isVariableDefinitionName(n),
      )!;
      const refs = analyzer.getReferences(funcDoc, getRange(variableNode).start);
      expect(refs).toHaveLength(1);
      compareReferences(funcDoc, variableNode, 1);
    });
  });

  describe('emit event references', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'event_test.fish',
        content: [
          'function event_test --on-event test_event',
          '    echo event test: $argv',
          'end',
          '',
          'function foo',
          '    function bar',
          '        function baz',
          '            echo baz',
          '            function qux',
          '                echo qux',
          '            end',
          '            qux',
          '        end',
          '        baz',
          '    end',
          '    bar',
          'end',
          'foo',
          '',
          'emit test_event something',
        ].join('\n'),
      },
      {
        relativePath: 'other_event_test.fish',
        content: [
          'function other_event_test --on-event test_event_2',
          '    echo other event test: $argv',
          'end',
          '',
          'emit test_event_2 something',
        ].join('\n'),
      },
      {
        relativePath: 'event_without_emit.fish',
        content: [
          '# NOT an autoloaded file',
          'function _event_without_emit --on-event test_event_a',
          '    echo event without emit',
          'end',
          '',
          'function other_event_without_emit --on-event test_event_b',
          '    echo other event without emit',
          'end',
          'function event_with_emit --on-event test_event_c',
          '    echo event with emit',
          'end',
          'emit test_event_c',
        ].join('\n'),
      },
      {
        relativePath: 'functions/custom_fish_prompt.fish',
        content: [
          'function custom_fish_prompt --on-event fish_prompt',
          '    echo "fish prompt $(pwd) >>>"',
          'end',
          '',
          'function __fish_configure_prompt --on-event reset_fish_prompt',
          '    echo resetting fish prompt',
          '    custom_fish_prompt',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'config.fish',
        content: [
          'custom_fish_prompt',
          'emit reset_fish_prompt',
        ].join('\n'),
      },
    ).initialize();

    describe('all unused references', () => {
      it('event_test.fish', () => {
        const focusedDoc = workspace.getDocument('event_test.fish')!;
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
        compareUnusedReferences(focusedDoc, 0);
      });

      it('other_event_test.fish', () => {
        const focusedDoc = workspace.getDocument('other_event_test.fish')!;
        const symbols = filterFirstPerScopeSymbol(focusedDoc);
        printClientTree({ log: true }, ...symbols);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        console.log('unused references', unusedRefs.length);
        printLocations(unusedRefs, {
          showIndex: true,
          showText: true,
          showLineText: true,
        });
        expect(unusedRefs).toHaveLength(0);
        compareUnusedReferences(focusedDoc, 0);
      });

      it('event_without_emit.fish', () => {
        const focusedDoc = workspace.getDocument('event_without_emit.fish')!;
        const symbols = filterFirstPerScopeSymbol(focusedDoc);
        printClientTree({ log: true }, ...symbols);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        console.log('unused references', unusedRefs.length);
        printLocations(unusedRefs, {
          showIndex: true,
          showText: true,
          showLineText: true,
        });
        expect(unusedRefs).toHaveLength(2);
        compareUnusedReferences(focusedDoc, 2);
      });

      it('custom_fish_prompt `--on-event fish_prompt` not emitted but not show unused', () => {
        const focusedDoc = workspace.getDocument('functions/custom_fish_prompt.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isFunction() && s.hasEventHook() && s.name === '__fish_configure_prompt')!;
        const allRefs = analyzer.getReferences(focusedDoc, focusedSymbol.toPosition());
        expect(allRefs).toHaveLength(1);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
        compareReferences(focusedDoc, focusedSymbol.toPosition(), 1);
        compareUnusedReferences(focusedDoc, 0);
      });

      it('config.fish `reset_fish_prompt` emitted', () => {
        const focusedDoc = workspace.getDocument('config.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const allRefs = analyzer.getReferences(focusedDoc, focusedSymbol.toPosition());
        expect(allRefs).toHaveLength(2);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
        compareReferences(focusedDoc, focusedSymbol.toPosition(), 2);
        compareUnusedReferences(focusedDoc, 0);
      });
    });

    describe('goto implementation', () => {
      it('config.fish `emit reset_fish_prompt`', () => {
        const focusedDoc = workspace.getDocument('config.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const impls = analyzer.getImplementation(focusedDoc, focusedSymbol.toPosition());
        const matchLocations = [matchLocation('functions/custom_fish_prompt.fish', 4, 44)];
        printLocations(impls, {
          showIndex: true,
          showText: true,
          showLineText: true,
          verbose: true,
        });
        expect(impls).toHaveLength(1);
        expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
        // toMatchLocations(impls)
      });

      it('functions/custom_fish_prompt.fish -> `emit reset_fish_prompt`', () => {
        const focusedDoc = workspace.getDocument('functions/custom_fish_prompt.fish')!;
        workspaceManager.setCurrent(workspace.getWorkspace()!);
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEventHook() && s.name === 'reset_fish_prompt')!;
        const impls = analyzer.getImplementation(focusedDoc, focusedSymbol.toPosition());
        const matchLocations = [matchLocation('config.fish', 1, 5)];
        expect(impls).toHaveLength(1);

        expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
      });

      it('alias value command resolves implementation from nested reference position', () => {
        workspaceManager.clear();
        const focusedDoc = createFakeLspDocument(`file:///${new Date().getMilliseconds()}/tmp/test-alias-implementation.fish`, [
          'function bar',
          'end',
          '',
          "alias bb 'bar'",
        ].join('\n'));
        workspace.addDocument(focusedDoc);

        analyzer.analyze(focusedDoc);
        workspace.focus(focusedDoc.uri);
        workspaceManager.setCurrent(workspace.getWorkspace()!);
        const impls = analyzer.getImplementation(focusedDoc, Position.create(3, 11));

        expect(impls).toHaveLength(1);
        expect(analyzer.getTextAtLocation(impls[0]!)).toBe('bar');

        toMatchLocations(impls);
        const matchLocations = [matchLocation('/tmp/test-alias-implementation.fish', 0, 10)];
        expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
      });

      // From a definition with no completion, the analyzer falls back to
      // getReferences so the cycle can still move — returns the def plus any
      // usages (e.g., the inner `bar` command inside `alias bb 'bar'`).
      it('definition with no completion returns def + usages', () => {
        const focusedDoc = createFakeLspDocument('/tmp/test-alias-implementation-cycle.fish', [
          'function bar',
          'end',
          '',
          "alias bb 'bar'",
        ].join('\n'));

        analyzer.analyze(focusedDoc);
        const impls = analyzer.getImplementation(focusedDoc, Position.create(0, 10));

        expect(impls).toHaveLength(2);
        expect(impls[0]!.range.start.line).toBe(0);
        expect(impls[1]!.range.start.line).toBe(3);

        const matchLocations = [
          matchLocation('/tmp/test-alias-implementation-cycle.fish', 0, 9),
          matchLocation('/tmp/test-alias-implementation-cycle.fish', 3, 10),
        ];
        expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
      });
    });

    // Cycle semantics for the reimplemented analyzer.getImplementation:
    //   usage → definition
    //   definition → completion (falls back to def + usages if no completion)
    //   completion → usage (back to definition if no usage exists)
    //   emit event → all --on-event handlers (and vice versa)
    describe('cycle semantics', () => {
      describe('function with completion', () => {
        const workspace = TestWorkspace.create().addFiles(
          {
            relativePath: 'functions/cycler.fish',
            content: [
              'function cycler',
              '    echo hi',
              'end',
            ].join('\n'),
          },
          {
            relativePath: 'completions/cycler.fish',
            content: [
              'complete -c cycler -s h -l help',
            ].join('\n'),
          },
          {
            relativePath: 'conf.d/use_cycler.fish',
            content: [
              'cycler --help',
            ].join('\n'),
          },
        ).initialize();

        it('usage → definition', () => {
          const useDoc = workspace.getDocument('conf.d/use_cycler.fish')!;
          const impls = analyzer.getImplementation(useDoc, Position.create(0, 2));
          expect(impls).toHaveLength(1);
          expect(impls[0]!.uri).toContain('functions/cycler.fish');
          toMatchLocations(impls);
          const matchLocations = [matchLocation('functions/cycler.fish', 0, 9)];

          expectFoundLocationsToEqualMatchLocations(impls, matchLocations);

          // compareImplementations(useDoc, Position.create(0, 2), 1);
        });

        it('definition → completion', () => {
          const funcDoc = workspace.getDocument('functions/cycler.fish')!;
          const impls = analyzer.getImplementation(funcDoc, Position.create(0, 10));
          expect(impls.length).toBeGreaterThanOrEqual(1);
          expect(impls.some(loc => loc.uri.includes('completions/cycler.fish'))).toBeTruthy();
          // toMatchLocations(impls)

          const matchLocations = [matchLocation('completions/cycler.fish', 0, 12)];
          expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
          // compareImplementations(funcDoc, Position.create(0, 10), impls.length);
        });

        it('completion → usage', () => {
          const compDoc = workspace.getDocument('completions/cycler.fish')!;
          const impls = analyzer.getImplementation(compDoc, Position.create(0, 12));
          expect(impls.length).toBeGreaterThanOrEqual(1);
          // Should land on a usage location somewhere outside the completions file.
          expect(impls.some(loc => !loc.uri.includes('completions/'))).toBeTruthy();
          // compareImplementations(compDoc, Position.create(0, 12), impls.length);
          const matchLocations = [matchLocation('conf.d/use_cycler.fish', 0, 0)];
          expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
        });
      });

      describe('function without completion', () => {
        const workspace = TestWorkspace.create().addFiles({
          relativePath: 'functions/lonely.fish',
          content: [
            'function lonely',
            '    echo solo',
            'end',
          ].join('\n'),
        }).initialize();

        it('definition stays on definition (no completion exists)', () => {
          const doc = workspace.getDocument('functions/lonely.fish')!;
          const impls = analyzer.getImplementation(doc, Position.create(0, 10));
          // Per the agreed semantics, def → no completion → stay on def.
          expect(impls).toHaveLength(1);
          expect(impls[0]!.uri).toContain('functions/lonely.fish');
          // compareImplementations(doc, Position.create(0, 10), 1);
          const matchLocations = [matchLocation('functions/lonely.fish', 0, 9)];
          expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
        });
      });

      describe('emit event with multiple handlers', () => {
        const workspace = TestWorkspace.create().addFiles(
          {
            relativePath: 'conf.d/emitter.fish',
            content: [
              'emit multi_event',
            ].join('\n'),
          },
          {
            relativePath: 'functions/handler_a.fish',
            content: [
              'function handler_a --on-event multi_event',
              '    echo a',
              'end',
            ].join('\n'),
          },
          {
            relativePath: 'functions/handler_b.fish',
            content: [
              'function handler_b --on-event multi_event',
              '    echo b',
              'end',
            ].join('\n'),
          },
        ).initialize();

        it('emit returns ALL --on-event handlers', () => {
          const emitDoc = workspace.getDocument('conf.d/emitter.fish')!;
          // `emit ` is 5 chars, `multi_event` starts at col 5.
          const impls = analyzer.getImplementation(emitDoc, Position.create(0, 6));
          const handlerUris = impls.map(loc => loc.uri);

          const matchLocations = [
            matchLocation('functions/handler_a.fish', 0, 30),
            matchLocation('functions/handler_b.fish', 0, 30),
          ];

          expect(handlerUris.some(u => u.includes('functions/handler_a.fish'))).toBeTruthy();
          expect(handlerUris.some(u => u.includes('functions/handler_b.fish'))).toBeTruthy();

          toMatchLocations(impls);
          expectFoundLocationsToEqualMatchLocations(impls, matchLocations);
          // Intentionally no compareImplementations here: the OLD impl
          // returned only the first handler. Once the reimpl lands the new
          // path returns ALL handlers, which is the behavior under test.
        });
      });
    });
  });

  describe('variable references edge cases', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/local_test_var.fish',
        content: [
          'set -g test_var # definition',
          'set other_test_var',
          'function local_test_var',
          '     set -l test_var local_1',
          '     echo $test_var    # skip',
          '     set -l other_test_var',
          '     echo $other_test_var',
          '     echo $global_test_var',
          '     if test -n "$test_var"  # skip',
          '         set -a test_var local_2',
          '     end',
          '     private_function',
          'end',
          'echo $test_var # outer 1',
          'function private_function',
          '     set test_var     # skip',
          '     set -l other_test_var',
          '     echo $test_var   # skip',
          '     echo $other_test_var',
          '     echo $global_test_var',
          '     set test_var     # skip',
          'end',
          'echo $test_var # outer 2',
          'function no_skip; echo $test_var; end # used in function',
          'function skip -a test_var; echo $test_var; end; # 3',
          'set test_var # global inherit 4',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/global_test_var.fish',
        content: [
          'set -gx global_test_var',
          'echo $global_test_var',
          'echo $test_var        # global ref 5',
          'set -U universal_v -gx',
          'set -gx global_fake_universal_v --universal',
          'set fake_universal_v --universal',
        ].join('\n'),
      },
    ).initialize();

    it('test global variable w/o local references', () => {
      const doc = workspace.getDocument('functions/local_test_var.fish')!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var')!;

      const refs = analyzer.getReferences(doc, focusedSymbol.toPosition());
      console.log({
        date: new Date().toISOString(),
        refs: refs.length,
      });
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(6);
      compareReferences(doc, focusedSymbol.toPosition(), 6);
    });

    it('test global variable w/ local references', () => {
      const doc = workspace.getDocument('functions/local_test_var.fish')!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      console.log('focusedSymbol', focusedSymbol.toString());
      const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      console.log('definition', def?.toString());

      const refs = analyzer.getReferences(doc, focusedSymbol.toPosition());
      const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(4);
      compareReferences(doc, focusedSymbol.toPosition(), 4);
    });

    it('test variable w/ local references && {localOnly: true}', () => {
      const doc = workspace.getDocument('functions/local_test_var.fish')!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      console.log('focusedSymbol', focusedSymbol.toString());
      const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      console.log('definition', def?.toString());

      const refs = analyzer.getReferences(doc, focusedSymbol.toPosition(), { localOnly: true });
      const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(4);
      compareReferences(doc, focusedSymbol.toPosition(), 4, { localOnly: true });
    });
  });

  // Coverage for the rescue passes inside analyzer.allUnusedLocalReferences()
  // — these exercise the "indirectly used" branches the first-pass scan can't
  // detect by name match alone (argparse aliases, --inherit-variable callers,
  // --no-scope-shadowing callees, --on-event handlers).
  describe('analyzer.allUnusedLocalReferences', () => {
    describe('plain locals', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'functions/unused_local.fish',
          content: [
            'function unused_local',
            '    set -l never_used bar',
            'end',
          ].join('\n'),
        },
        {
          relativePath: 'functions/used_local.fish',
          content: [
            'function used_local',
            '    set -l consumed bar',
            '    echo $consumed',
            'end',
          ].join('\n'),
        },
      ).initialize();

      it('flags a `set -l` with no reads', () => {
        const doc = workspace.getDocument('functions/unused_local.fish')!;
        compareUnusedReferences(doc, 1, ['never_used']);
      });

      it('does not flag a `set -l` that is read', () => {
        const doc = workspace.getDocument('functions/used_local.fish')!;
        compareUnusedReferences(doc, 0);
      });
    });

    describe('argparse equivalence rescue', () => {
      const workspace = TestWorkspace.create().addFiles({
        relativePath: 'functions/arg_with_flag.fish',
        content: [
          'function arg_with_flag',
          "    argparse 'h/help' v/verbose -- $argv",
          '    or return',
          '    if set -q _flag_help',
          '        echo help',
          '    end',
          'end',
        ].join('\n'),
      }).initialize();

      it('`h/help` reached via `_flag_help` is not flagged unused', () => {
        const doc = workspace.getDocument('functions/arg_with_flag.fish')!;
        // The OLD impl is the source of truth — compareUnusedReferences asserts
        // analyzer's reimplementation matches it, whatever the exact set is.
        const baseline = analyzer.allUnusedLocalReferences(doc);
        const baselineNames = baseline.map(s => s.name).sort();
        compareUnusedReferences(doc, baseline.length, baselineNames);
        // `_flag_help` is in the body, so the argparse symbol for help/h must
        // not be reported as unused.
        expect(baselineNames.includes('help')).toBeFalsy();
        expect(baselineNames.includes('h')).toBeFalsy();
      });
    });

    describe('--inherit-variable rescue', () => {
      const workspace = TestWorkspace.create().addFiles({
        relativePath: 'functions/inherit_outer.fish',
        content: [
          'function inherit_outer',
          '    set -l shared_var hello',
          '    inherit_inner',
          'end',
          'function inherit_inner --inherit-variable shared_var',
          '    echo $shared_var',
          'end',
        ].join('\n'),
      }).initialize();

      it('local var is not flagged when inherited by a function called in scope', () => {
        const doc = workspace.getDocument('functions/inherit_outer.fish')!;
        const unusedNames = analyzer.allUnusedLocalReferences(doc).map(s => s.name);
        expect(unusedNames).not.toContain('shared_var');
        compareUnusedReferences(doc, analyzer.allUnusedLocalReferences(doc).length);
      });
    });

    describe('--no-scope-shadowing rescue', () => {
      const workspace = TestWorkspace.create().addFiles({
        relativePath: 'functions/no_scope_outer.fish',
        content: [
          'function no_scope_outer',
          '    set -l leaked_var hello',
          '    no_scope_inner',
          'end',
          'function no_scope_inner --no-scope-shadowing',
          '    echo $leaked_var',
          'end',
        ].join('\n'),
      }).initialize();

      it('local var is not flagged when a --no-scope-shadowing callee reads it', () => {
        const doc = workspace.getDocument('functions/no_scope_outer.fish')!;
        const unusedNames = analyzer.allUnusedLocalReferences(doc).map(s => s.name);
        expect(unusedNames).not.toContain('leaked_var');
        compareUnusedReferences(doc, analyzer.allUnusedLocalReferences(doc).length);
      });
    });
  });

  // Cross-file references for an alias picked up via `--wraps`/`-w` flags on
  // both `function ... --wraps X` declarations and `complete -c ... -w X`.
  // The alias `lsd` is defined once in conf.d/ and used as a wrap target by two
  // separate functions and one completion; references should land on every
  // occurrence (defs, wrap mentions, body calls).
  describe('alias `lsd` with --wraps cross-file', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'conf.d/aliases.fish',
        content: [
          'alias lsd=\'exa --only-dirs -1\'',
        ].join('\n'),
      },
      {
        relativePath: 'functions/show-dirs.fish',
        content: [
          'function show-dirs -w=lsd',
          '    lsd $argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'completions/show-dirs.fish',
        content: [
          'complete -c show-dirs -w lsd -f',
          'complete -c show-dirs -w \'lsd\' -f',
        ].join('\n'),
      },
      {
        relativePath: 'functions/other-dirs.fish',
        content: [
          'function other-dirs --wraps lsd',
          '    lsd $argv',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('analyzer.getReferences matches getReferences across all 4 files', () => {
      const aliasDoc = workspace.getDocument('conf.d/aliases.fish')!;
      const showFunc = workspace.getDocument('functions/show-dirs.fish')!;
      const showComp = workspace.getDocument('completions/show-dirs.fish')!;
      const otherFunc = workspace.getDocument('functions/other-dirs.fish')!;
      expect(aliasDoc).toBeDefined();
      expect(showFunc).toBeDefined();
      expect(showComp).toBeDefined();
      expect(otherFunc).toBeDefined();

      // Look up the alias symbol — tree-sitter concatenates `lsd='…'` into a
      // single node, so finding "lsd" by text alone doesn't work; the symbol
      // table is the reliable anchor.
      const aliasSymbol = analyzer.getFlatDocumentSymbols(aliasDoc.uri)
        .find(s => s.name === 'lsd' && s.fishKind === 'ALIAS')!;
      expect(aliasSymbol).toBeDefined();
      const defPos = aliasSymbol.toPosition();

      const refs = analyzer.getReferences(aliasDoc, defPos);
      const refUris = new Set(refs.map(loc => loc.uri));

      // Sanity check: every file that mentions `lsd` contributed at least one
      // reference. If the parser stops picking up `-w=lsd` short form or
      // `--wraps lsd` long form this assertion catches it immediately.
      expect(refUris.has(aliasDoc.uri)).toBeTruthy();
      expect(refUris.has(showFunc.uri)).toBeTruthy();
      expect(refUris.has(otherFunc.uri)).toBeTruthy();

      // TODO(`complete -w lsd`): NOT surface `-w=lsd` but does `-w lsp` inside a `complete` command.
      expect(refUris.has(showComp.uri)).toBeTruthy();

      // refs.forEach(({ uri, range }, idx) => {
      //   console.log(idx, analyzer.getDocument(uri)?.getText(range));
      // });

      // Load-bearing assertion for the refactor: whatever set is picked up,
      // both impls must agree on count + ordering.
      compareReferences(aliasDoc, defPos, refs.length);
    });
  });

  // Regression: in `for file in …; source $file; end`, goto-definition on
  // the `$file` argument to `source` returned [] because `getDefinitionLocation`
  // unconditionally took the source-argument fast path and tried to resolve
  // `$file` as a literal path. With the fix it falls through to symbol
  // resolution when the source-path resolution finds nothing, so the cursor
  // jumps to the `for file` loop variable.
  describe('source $var goto-definition', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'config.fish',
      content: [
        'for file in *.fish',
        '    test -f $file',
        '    and source $file',
        'end',
      ].join('\n'),
    }).initialize();

    it('goto-definition on `$file` in `source $file` resolves to the loop variable', () => {
      const doc = workspace.getDocument('config.fish')!;
      // `$file` text spans cols 15..20 on line 1; cursor in the middle of `file`
      const defs = analyzer.getDefinitionLocation(doc, Position.create(2, 18));
      expect(defs.length).toBeGreaterThan(0);
      expect(defs[0]!.uri).toBe(doc.uri);
      expect(defs[0]!.range.start.line).toBe(0);
    });
  });

  // Regression: opening tests/workspaces/example_test_src/config.fish and
  // requesting references for `$fish_user_paths` at line 93 returned a hit
  // from fish-lsp's own bundled file `fish_files/get-fish-autoloaded-paths.fish`,
  // which lives outside the opened workspace. `getReferences()` already filters
  // via getDocumentsToSearch(); `analyzer.getReferences()` must do the same so
  // its cached findForSymbol() result is scoped to the current workspace.
  describe('workspace scoping', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'config.fish',
      content: [
        'set -gx my_unique_test_var foo',
        'echo $my_unique_test_var',
      ].join('\n'),
    }).initialize();

    it('analyzer.getReferences excludes documents outside the current workspace', () => {
      const doc = workspace.getDocument('config.fish')!;
      expect(doc).toBeDefined();

      // Index a stray doc that lives outside the test workspace. This mimics
      // the production case where fish-lsp's own bundled fish_files (or any
      // other indexed workspace) appears alongside the user's workspace.
      const strayDoc = createFakeLspDocument(
        '/tmp/cross-workspace-leak-test/foo.fish',
        'echo $my_unique_test_var',
      );
      analyzer.analyze(strayDoc);

      // createFakeLspDocument may set the stray's workspace as current; put
      // the test workspace back so the reference query is scoped to it.
      workspaceManager.setCurrent(doc.getWorkspace()!);

      console.log(workspaceManager.all.map(ws => ws.name));
      expect(workspaceManager.all).toHaveLength(2);

      const defNode = analyzer.getNodes(doc.uri).find(n =>
        n.text === 'my_unique_test_var' && isVariableDefinitionName(n),
      )!;
      expect(defNode).toBeDefined();

      const refs = analyzer.getReferences(doc, getRange(defNode).start);
      const strayInRefs = refs.some(loc => loc.uri === strayDoc.uri);
      expect(strayInRefs).toBeFalsy();

      // Both paths must agree, and the OLD path already filters by workspace.
      compareReferences(doc, defNode, refs.length);
    });
  });
});
