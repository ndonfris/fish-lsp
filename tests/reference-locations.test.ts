import { analyzer, Analyzer } from '../src/analyze';
import { workspaceManager } from '../src/utils/workspace-manager';
import { createFakeLspDocument, createTestServer, expectFoundLocationsToEqualMatchLocations, matchLocation, printLocations, setLogger, type TestServerHandle } from './helpers';
import FishServer from '../src/server';
import { getChildNodes, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { isCompletionCommandDefinition } from '../src/parsing/complete';
import { isArgumentThatCanContainCommandCalls, isCommand, isCommandWithName, isDefinitionName, isFunctionDefinitionName, isOption, isString, isVariable, isVariableDefinitionName } from '../src/utils/node-types';
import { getArgparseDefinitionName, isCompletionArgparseFlagWithCommandName } from '../src/parsing/argparse';
import { getRenames } from '../src/renames';
import { Position, Location, ReferenceParams } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../src/document';
import { FishSymbol } from '../src/parsing/symbol';
import { isMatchingOptionValue } from '../src/parsing/options';
import { Option } from '../src/parsing/options';
import { extractCommands, extractMatchingCommandLocations } from '../src/parsing/nested-strings';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import TestWorkspace from './test-workspace-utils';
import { logger } from '../src/logger';
import { fail } from 'assert';
import { FunctionParser } from '../src/parsing/barrel';
import { isAliasDefinitionName } from '../src/parsing/alias';
import { isSetQueryDefinition } from '../src/parsing/set';

beforeEach(() => {
  logger.setSilent(); // pass in `false` to enable logs
});
afterEach(() => {
  logger.setSilent(true);
});

describe('find reference locations of symbols', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
    // Object.assign(config, ConfigSchema.parse({}))
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
        const result = analyzer.getReferences(confdDoc, getRange(nodeAtPoint).start);
        expect(result).toHaveLength(4);
      }
    });

    it('test _flag_help', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === '_flag_yes';
      })!;
      expect(found).toBeDefined();
      const result = analyzer.getReferences(functionDoc, getRange(found).start);
      // const foundSymbol = analyzer.getDefinition(functionDoc, getRange(found).start);
      // // console.log(foundSymbol?.toString());
      // const sorter = FishReferenceCandidate.comparatorForSymbol(foundSymbol!);
      // const result2 = [
      //   FishReferenceCandidate.fromSymbol(foundSymbol!),
      //   ...analyzer.referenceCandidates.findForSymbol(foundSymbol!).filter(rc => foundSymbol?.isReference(rc.document, rc.node, true)),
      // ].sort(sorter);
      // const result3 = analyzer.getReferences(functionDoc, getRange(found).start);
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
      // console.log({
      //   result: result.map(loc => locationAsString(loc)),
      //   // result2: result2.map(({ node, document }) => ({
      //   //   text: node.text,
      //   //   uri: LspDocument.testUri(document.uri),
      //   result2: result2.map((item) => {
      //     const { document, name, node, range } = item;
      //     return {
      //       uri: LspDocument.testUri(document.uri),
      //       name: name,
      //       node: node.text,
      //       range: rangeAsString(range),
      //       loc: locationAsString(item.toLocation()),
      //     };
      //   }),
      //   result3: result3.map(loc => locationAsString(loc)),
      // });

      expect(result).toHaveLength(4);
    });

    it('test _flag_version', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 52)!;
      expect(nodeAtPoint!.text).toBe('v/version');
      const refs = analyzer.getReferences(functionDoc, Position.create(1, 52));
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
      const newRefs = analyzer.getReferences(completionDoc, Position.create(0, 27));
      expect(refs).toHaveLength(3);
      expect(refs).toEqual(newRefs);
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
      });
    });
  });

  describe('complete -a arguments', () => {
    // `-a`/`--arguments` value of a `complete` command is a literal completion
    // candidate string, not shell code. Only a command substitution `(...)`
    // actually invokes a command, so `complete -c bob -a "ls"` must NOT reference
    // the `ls` function, while `complete -c bob -a '(ls)'` must.
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/ls.fish',
        content: [
          'function ls',
          '    echo hi',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'completions/bob.fish',
        content: [
          // line 0: literal candidate "ls" — must NOT reference the `ls` function
          'complete -c bob -n \'__fish_bob_needs_command\' -f -a "ls" -d \'literal candidate\'',
          // line 1: command substitution (ls) — MUST reference the `ls` function
          'complete -c bob -n \'__fish_bob_needs_command\' -f -a \'(ls)\' -d \'command substitution\'',
        ].join('\n'),
      },
    ).initialize();

    it('only `(ls)` references the `ls` function, not the literal "ls"', () => {
      const functionDoc = workspace.getDocument('functions/ls.fish')!;
      const completionDoc = workspace.getDocument('completions/bob.fish')!;
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();

      const defName = analyzer.findNode((n, document) =>
        document!.uri === functionDoc.uri
        && n.text === 'ls'
        && isFunctionDefinitionName(n),
      )!;
      expect(defName).toBeDefined();

      const refs = analyzer.getReferences(functionDoc, getRange(defName).start);
      const completionRefs = refs.filter(loc => loc.uri.endsWith('completions/bob.fish'));

      // The literal `complete -a "ls"` (line 0) must not be a reference.
      expect(completionRefs.some(loc => loc.range.start.line === 0)).toBe(false);
      // The command substitution `complete -a '(ls)'` (line 1) must be a reference.
      expect(completionRefs.some(loc => loc.range.start.line === 1)).toBe(true);
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
      expect(result).toHaveLength(2);
    });

    it('foo local in functions/test.fish `5 refs for \'foo\'`', () => {
      const functionDoc = workspace.getDocument('functions/test.fish')!;
      const node = analyzer.getNodes(functionDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      expect(node).toBeDefined();
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
      expect(result).toHaveLength(5);
    });

    it('foo global', () => {
      const globalTestDoc = workspace.getDocument('conf.d/global_test.fish')!;
      const node = analyzer.getNodes(globalTestDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      expect(node).toBeDefined();
      const result = analyzer.getReferences(globalTestDoc, getRange(node).start);
      // printLocations(result, {
      //   showText: true,
      //   showLineText: true,
      // });
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
    });

    it('set -eg does NOT end global variable lifetime for later references', () => {
      // A global/universal variable is a single shared entity; `set -eg` is a
      // runtime state change, not a new binding, so it must not partition the
      // variable's references. The `echo $some_var` after the erase (line 3) still
      // refers to the same global definition.
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
      expect(refLines.has(3)).toBeTruthy(); // post-erase read is still a reference
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

      // const erefs = analyzer.getReferences(doc, getRange(editorDef!).start);
      // const o_localRefs = analyzer.getReferences(doc, getRange(localDef!).start, {
      //   includeDefinitions: false,
      // });

      // console.log({
      //   editorRefs: editorRefs.map(loc => locationAsString(loc)),
      //   erefs: erefs.map(loc => locationAsString(loc)),
      //   pos: rangeAsString(getRange(editorDef!)),
      //   o_localRefs: o_localRefs.map(loc => locationAsString(loc)),
      // });
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

    it('global alias `ls` (using cache via `getReferences()`)', () => {
      const searchDoc = workspace.getDocument('conf.d/alias.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri
          && n.text.startsWith('ls')
          && isAliasDefinitionName(n);
      })!;
      expect(found).toBeDefined();
      workspace.documents.forEach((doc) => analyzer.ensureCachedDocument(doc));
      // Order reflects the comparator: def URI (100) → autoloaded completion
      // for THIS symbol (75) → other completions/* (50) → regular workspace
      // files (10). Within a band, URIs are sorted lexically (stable
      // regardless of the randomized TestWorkspace directory name).
      const matchLocations = [
        matchLocation('conf.d/alias.fish', 0, 6),
        matchLocation('completions/ls.fish', 0, 12),
        matchLocation('completions/ls-wrapper.fish', 0, 27),
        matchLocation('conf.d/abbrevaitons.fish', 0, 11),
        matchLocation('conf.d/abbrevaitons.fish', 1, 14),
        matchLocation('conf.d/abbrevaitons.fish', 2, 18),
        matchLocation('functions/ls-wrapper.fish', 0, 23),
        matchLocation('functions/ls-wrapper.fish', 1, 16),
        matchLocation('functions/ls-wrapper.fish', 3, 4),
        matchLocation('functions/test-other.fish', 1, 4),
        matchLocation('functions/user_keybinds.fish', 1, 24),
      ];
      // const matchLocations = [
      //   matchLocation('conf.d/alias.fish', 0, 6),
      //   matchLocation('completions/ls.fish', 0, 13),
      //   matchLocation('functions/test-other.fish', 1, 5),
      //   // matchLocation('completions/ls.fish', 0, 31), // missing?
      //   matchLocation('completions/ls-wrapper.fish', 0, 28), // missing?
      //   matchLocation('functions/ls-wrapper.fish', 0, 24),
      //   // matchLocation('functions/ls-wrapper.fish', 0, 44), // missing?
      //   matchLocation('functions/ls-wrapper.fish', 1, 17),
      //   matchLocation('functions/ls-wrapper.fish', 3, 5),
      //   matchLocation('functions/user_keybinds.fish', 1, 24),
      //   matchLocation('conf.d/abbrevaitons.fish', 0, 12),
      //   matchLocation('conf.d/abbrevaitons.fish', 1, 15),
      //   matchLocation('conf.d/abbrevaitons.fish', 2, 18),
      // ];
      // debugMatchLocations(matchLocations, workspace, {
      //   showDocs: true,
      //   separator: true,
      // });
      const refs = analyzer.getReferences(searchDoc, getRange(found).start);
      // toMatchLocations(refs)
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
      // compareFoundLocationsToMatchLocations(refs, matchLocations);
      expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
      expect(refs).toHaveLength(matchLocations.length);
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
      const builtinRefs = analyzer.getReferences(searchDoc, getRange(found).start);
      // console.log('builtinRefs', builtinRefs.length);
      printLocations(builtinRefs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(builtinRefs).toHaveLength(12);
    });

    it('local alias', () => {
      const searchDoc = workspace.getDocument('functions/local-alias.fish')!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      // console.log(searchDoc.getText());
      const result = analyzer.getReferences(searchDoc, getRange(found).start);
      expect(result).toHaveLength(2);
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
      // console.log(uris);
      expect(uris.has('functions/test.fish')).toBeTruthy();
      expect(uris.has('functions/test-other.fish')).toBeFalsy();
      expect(uris.has('completions/foo.fish')).toBeTruthy();
      expect(uris.has('conf.d/foo.fish')).toBeTruthy();
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
        // console.log(nodeAtPoint?.text);
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
        const document = workspace.getDocument('conf.d/test.fish')!;
        const cached = analyzer.analyze(document).ensureParsed();
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        // console.log(nodeAtPoint?.text);
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
        // console.debug(1, nodeAtPoint?.text);
        const defSymbol = analyzer.getDefinition(functionDoc, Position.create(1, 49));
        expect(defSymbol).toBeDefined();
        const refs = analyzer.getReferences(functionDoc, Position.create(1, 49));
        // console.log('def', {
        //   defSymbol,
        //   uri: defSymbol?.uri,
        //   rangeStart: defSymbol?.selectionRange.start,
        //   rangeEnd: defSymbol?.selectionRange.end,
        //   text: defSymbol?.name,
        // });
        // printLocations(refs, {
        //   verbose: true,
        // });

        const renames = getRenames(functionDoc, Position.create(1, 49), 'na');
        const newTexts: Set<string> = new Set();
        renames.forEach(loc => {
          newTexts.add(loc.newText);
        });
        expect(refs).toHaveLength(5);
        expect(newTexts.size === 1).toBeTruthy();
      });

      it('argparse `special-option` test', () => {
        const functionDoc = workspace.getDocument('functions/foo_test.fish')!;
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 27);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('special-option');
        // console.log(2, nodeAtPoint?.text);
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
          // console.log('location ref', {
          //   uri: loc.uri,
          //   rangeStart: loc.range.start,
          //   rangeEnd: loc.range.end,
          //   docText: analyzer.getTextAtLocation(loc),
          //   docLine: analyzer.getDocument(loc.uri)!.getLine(loc.range.start.line),
          //   text: loc.newText,
          // });
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
        const renames = getRenames(functionDoc, Position.create(0, 11), 'test-rename');

        const refUris = new Set(renames.map(loc => loc.uri));
        expect(renames).toHaveLength(refs.length);
        expect(refUris.size).toBe(4);
      });

      it('config.fish $argv rename', () => {
        const configDoc = workspace.getDocument('config.fish')!;
        const argvNode = analyzer.getNodes(configDoc.uri)
          .find(n => n.text === '$argv' && n.parent && isCommand(n.parent))!;
        // console.log({
        //   argvNode: {
        //     text: argvNode.text,
        //     type: argvNode.type,
        //     startPosition: argvNode.startPosition,
        //     endPosition: argvNode.endPosition,
        //   },
        //   parent: {
        //     type: argvNode.parent?.type,
        //     text: argvNode.parent?.text,
        //   },
        //   uri: configDoc.uri,
        // });
        const pos = pointToPosition(argvNode!.startPosition);
        const renames = getRenames(configDoc, pos, 'test-argv');
        expect(renames.length === 0).toBeTruthy();
      });

      it('alias `baz` references && renames', () => {
        const configDoc = workspace.getDocument('config.fish')!;
        const bazNode = analyzer.getFlatDocumentSymbols(configDoc.uri)
          .find(s => s.name === 'baz' && s.fishKind === 'ALIAS')!;
        // console.log({
        //   bazNode: {
        //     name: bazNode.name,
        //     uri: bazNode.uri,
        //     range: bazNode.range,
        //     selectionRange: bazNode.selectionRange,
        //   },
        // });
        const bazLocation = bazNode.toLocation();
        const refs = analyzer.getReferences(configDoc, bazLocation.range.start);
        const renames = getRenames(configDoc, bazLocation.range.start, 'baz_test');
        expect(refs).toHaveLength(2);
        expect(renames).toHaveLength(2);
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
      });
    });

    it('function `test` -> `argv` references w/ `set -l argv`', () => {
      const funcDoc = workspace.getDocument('functions/_test.fish')!;
      const variableNode = analyzer.getNodes(funcDoc.uri).find(
        n => isVariableDefinitionName(n),
      )!;
      const refs = analyzer.getReferences(funcDoc, getRange(variableNode).start);
      expect(refs).toHaveLength(1);
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
      });

      it('other_event_test.fish', () => {
        const focusedDoc = workspace.getDocument('other_event_test.fish')!;
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        // console.log('unused references', unusedRefs.length);
        // printLocations(unusedRefs, {
        //   showIndex: true,
        //   showText: true,
        //   showLineText: true,
        // });
        expect(unusedRefs).toHaveLength(0);
      });

      it('event_without_emit.fish', () => {
        const focusedDoc = workspace.getDocument('event_without_emit.fish')!;
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        // console.log('unused references', unusedRefs.length);
        // printLocations(unusedRefs, {
        //   showIndex: true,
        //   showText: true,
        //   showLineText: true,
        // });
        expect(unusedRefs).toHaveLength(2);
      });

      it('custom_fish_prompt `--on-event fish_prompt` not emitted but not show unused', () => {
        const focusedDoc = workspace.getDocument('functions/custom_fish_prompt.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isFunction() && s.hasEventHook() && s.name === '__fish_configure_prompt')!;
        const allRefs = analyzer.getReferences(focusedDoc, focusedSymbol.toPosition());
        expect(allRefs).toHaveLength(1);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
      });

      it('config.fish `reset_fish_prompt` emitted', () => {
        const focusedDoc = workspace.getDocument('config.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const allRefs = analyzer.getReferences(focusedDoc, focusedSymbol.toPosition());
        expect(allRefs).toHaveLength(2);
        const unusedRefs = analyzer.allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
      });
    });

    describe('goto implementation', () => {
      beforeEach(() => {
        workspaceManager.clear();
      });

      afterEach(() => {
        workspaceManager.clear();
      });

      it('config.fish `emit reset_fish_prompt`', () => {
        const focusedDoc = workspace.getDocument('config.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const impls = analyzer.getImplementation(focusedDoc, focusedSymbol.toPosition());
        // printLocations(impls, {
        //   showIndex: true,
        //   showText: true,
        //   showLineText: true,
        //   verbose: true,
        // });
        expect(impls).toHaveLength(1);
      });

      it('functions/custom_fish_prompt.fish -> `emit reset_fish_prompt`', () => {
        const focusedDoc = workspace.getDocument('functions/custom_fish_prompt.fish')!;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEventHook() && s.name === 'reset_fish_prompt')!;
        const impls = analyzer.getImplementation(focusedDoc, focusedSymbol.toPosition());
        // printLocations(impls, {
        //   showIndex: true,
        //   showText: true,
        //   showLineText: true,
        //   verbose: true,
        // });
        expect(impls).toHaveLength(1);
      });

      it('alias value command resolves implementation from nested reference position', () => {
        const focusedDoc = createFakeLspDocument('file:///tmp/test-alias-implementation.fish', [
          'function bar',
          'end',
          '',
          "alias bb 'bar'",
        ].join('\n'));

        analyzer.analyze(focusedDoc);
        const impls = analyzer.getImplementation(focusedDoc, Position.create(3, 11));

        expect(impls).toHaveLength(1);
        expect(analyzer.getTextAtLocation(impls[0]!)).toBe('bar');
      });

      it('cycles to references when implementation would not move the cursor', async () => {
        const focusedDoc = createFakeLspDocument('/tmp/test-alias-implementation-cycle.fish', [
          'function bar',
          'end',
          '',
          "alias bb 'bar'",
        ].join('\n'));

        analyzer.analyze(focusedDoc);
        [
          {
            impls: analyzer.getImplementation(focusedDoc, Position.create(0, 10)),
            matchImpls: [
              matchLocation('/tmp/test-alias-implementation-cycle.fish', 3, 10),
            ],
          },
          {
            impls: analyzer.getImplementation(focusedDoc, Position.create(3, 10)),
            matchImpls: [
              matchLocation('/tmp/test-alias-implementation-cycle.fish', 0, 10),
            ],
          },
        ].forEach(({ impls, matchImpls }) => {
          expectFoundLocationsToEqualMatchLocations(impls, matchImpls);
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
      // console.log({
      //   date: new Date().toISOString(),
      //   refs: refs.length,
      // });
      // printLocations(refs, {
      //   showText: true,
      //   showLineText: true,
      //   showIndex: true,
      // });
      expect(refs).toHaveLength(6);
    });

    it('test global variable w/ local references', () => {
      const doc = workspace.getDocument('functions/local_test_var.fish')!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      // console.log('focusedSymbol', focusedSymbol.toString());
      // const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      // console.log('definition', def?.toString());

      const refs = analyzer.getReferences(doc, focusedSymbol.toPosition());
      // const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      // console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      // printLocations(refs, {
      //   showText: true,
      //   showLineText: true,
      //   showIndex: true,
      // });
      expect(refs).toHaveLength(4);
    });

    it('test variable w/ local references && {localOnly: true}', () => {
      const doc = workspace.getDocument('functions/local_test_var.fish')!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      // console.log('focusedSymbol', focusedSymbol.toString());
      // const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      // console.log('definition', def?.toString());

      const refs = analyzer.getReferences(doc, focusedSymbol.toPosition(), { localOnly: true });
      // const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      // console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      // printLocations(refs, {
      //   showText: true,
      //   showLineText: true,
      //   showIndex: true,
      // });
      expect(refs).toHaveLength(4);
    });
  });

  describe('functions', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'config.fish',
        content: [
          'function foo',
          '    echo \'inside foo\'',
          'end',
          'functions -a foo',
          'functions -aq foo',
          'functions --color always foo',
          'functions --copy foo bar',
          'functions --no-details --verbose -a foo',
          'functions -Dva foo',
          'functions -e foo',
        ].join('\n'),
      },
    ).initialize();

    it('ensure all isFunctionsReference(node) === `foo` | `bar`', () => {
      const doc = workspace.getDocument('config.fish')!;

      const refNodes = analyzer.getNodes(doc.uri)
        .filter(n => FunctionParser.isFunctionsReference(n));

      const refText = new Set(refNodes.map(refNode => refNode.text));
      expect(refText.size).toBe(2);
      expect(refText).toContain('foo');
      expect(refText).toContain('bar');
    });

    it('def: foo', () => {
      const doc = workspace.getDocument('config.fish')!;
      const pos = Position.create(7, 36);

      const matchLocations = [
        matchLocation('config.fish', 0, 9),
        matchLocation('config.fish', 3, 13),
        matchLocation('config.fish', 4, 14),
        matchLocation('config.fish', 5, 25),
        matchLocation('config.fish', 6, 17),
        matchLocation('config.fish', 7, 36),
        matchLocation('config.fish', 8, 15),
        matchLocation('config.fish', 9, 13),
      ];

      const def = analyzer.getDefinition(doc, pos);
      expect(def).toBeDefined();

      const defMatch = matchLocations[0]!;
      expect(defMatch.equalsLocation(def!)).toBeTruthy();

      const refs = analyzer.getReferences(doc, pos);
      expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
    });

    it('ref: foo', () => {
      const doc = workspace.getDocument('config.fish')!;
      const pos = Position.create(0, 9);

      const matchLocations = [
        matchLocation('config.fish', 0, 9),
        matchLocation('config.fish', 3, 13),
        matchLocation('config.fish', 4, 14),
        matchLocation('config.fish', 5, 25),
        matchLocation('config.fish', 6, 17),
        matchLocation('config.fish', 7, 36),
        matchLocation('config.fish', 8, 15),
        matchLocation('config.fish', 9, 13),
      ];

      const def = analyzer.getDefinition(doc, pos);
      expect(def).toBeDefined();

      const defMatch = matchLocations[0]!;
      expect(defMatch.equalsLocation(def!)).toBeTruthy();

      // const refNodes = analyzer.getNodes(doc.uri).filter(n => {
      //   return FunctionParser.isFunctionsReference(n);
      // })!.forEach(refNode => {
      //   console.log({
      //     isFunctionsReference: FunctionParser.isFunctionsReference(refNode),
      //     node: {
      //       text: refNode.text,
      //       type: refNode.type,
      //       range: rangeAsString(getRange(refNode)),
      //     }
      //   });
      // })

      const refs = analyzer.getReferences(doc, pos);
      // toMatchLocations(refs)
      expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
    });
  });

  // Regression: tree-sitter parses `alias foo=ref_cmd` as a single bare `word`
  // node `foo=ref_cmd` (no concatenation). Three paths needed updates to keep
  // working in that shape:
  //   1) `wordAtPoint` was always returning the part before `=`, so cursor on
  //      `ref_cmd` looked up the alias name instead.
  //   2) The reference-candidate cache only indexed `foo=ref_cmd` under that
  //      literal name, missing `ref_cmd` lookups.
  //   3) `extractMatchingCommandLocations` (via `findDirectCommandOffsets`)
  //      returned the whole token as the command, so the precise inner
  //      location filter never matched `ref_cmd`.
  describe('alias unquoted `foo=ref_cmd` references', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'config.fish',
      content: [
        'function ref_cmd; end',
        'alias foo=ref_cmd',
      ].join('\n'),
    }).initialize();

    it('getDefinition with cursor on `ref_cmd` value resolves to the function', () => {
      const doc = workspace.getDocument('config.fish')!;
      // `foo=ref_cmd` spans cols 6..17; `ref_cmd` starts at col 10
      const def = analyzer.getDefinition(doc, Position.create(1, 12));
      expect(def).toBeDefined();
      expect(def!.name).toBe('ref_cmd');
      expect(def!.selectionRange.start.line).toBe(0);
    });

    it('getReferences from the function definition includes the alias-value usage', () => {
      const doc = workspace.getDocument('config.fish')!;
      // Cursor on the function-definition `ref_cmd` (line 0, col 9..16)
      const refs = analyzer.getReferences(doc, Position.create(0, 12));
      const matchLocations = [
        matchLocation('config.fish', 0, 9),  // definition itself
        matchLocation('config.fish', 1, 10), // `ref_cmd` half of `foo=ref_cmd`
      ];
      expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
    });
  });

  describe('argparse symbol', () => {
    const testWorkspace = TestWorkspace.create().addFiles({
      relativePath: 'playground.fish',
      content: [
        'function greet -d "Greet someone by name"',          // 0
        "    argparse 'n/name=' -- $argv",                    // 1
        '    or return 1',                                    // 2
        '',                                                   // 3
        '    not set -ql _flag_name',                         // 4
        '    and set _flag_name "world"',                     // 5
        '',                                                   // 6
        '    echo "Hello, $_flag_name!"',                     // 7
        'end',                                                // 8
        '',                                                   // 9
        'greet --name="fish-lsp user"',                       // 10  bug case
        'greet --name "fish-lsp user"',                       // 11  works
      ].join('\n'),
    }).initialize();

    it('--name= vs --name', () => {
      const doc = testWorkspace.getDocument('playground.fish')!;
      const focused = analyzer.getNodes(doc.uri).filter(node => {
        return node.type === 'word' && node.text.startsWith('--name');
      });
      expect(focused).toHaveLength(2);

      const defs: FishSymbol[] = [];
      for (const node of focused) {
        const def = analyzer.getDefinition(doc, pointToPosition(node.startPosition));
        if (def) defs.push(def);
      }
      expect(defs).toHaveLength(2);

      const matchLocations = [
        matchLocation('playground.fish', 1, 16),
        matchLocation('playground.fish', 4, 16),
        matchLocation('playground.fish', 5, 12),
        matchLocation('playground.fish', 7, 18),
        matchLocation('playground.fish', 10, 8),
        matchLocation('playground.fish', 11, 8),
      ];

      for (const def of defs) {
        const refs = analyzer.getReferences(doc, def.selectionRange.start);
        // console.log(`refs for def ${def.toString()}:`, refs.map(r => rangeAsString(r.range)).join(', '));
        expect(refs).toHaveLength(6);
        expectFoundLocationsToEqualMatchLocations(refs, matchLocations);
      }
    });
  });

  describe('ambigous `set -q`', () => {
    const tw = TestWorkspace.create({ name: 'set_q' }).addFiles(
      {
        relativePath: 'conf.d/editor.fish',
        content: [
          'set -q EDITOR || set -gx EDITOR nvim',
          '',
          'set -q VISUAL',
          'or set -gx VISUAL nvim',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/local-editor.fish',
        content: [
          'set -ql EDITOR || set -lx EDITOR nvim',
        ].join('\n'),
      },
    ).initialize();

    const findDefNode = (doc: LspDocument, name: string) => analyzer.getNodes(doc.uri).find(n =>
      isVariableDefinitionName(n) && n.text === name,
    )!;

    const findQueryNode = (doc: LspDocument, name: string) => analyzer.getNodes(doc.uri).find(n =>
      n.parent && isSetQueryDefinition(n.parent) && n.text === name,
    )!;

    const GLOBAL_EDITOR_MatchLocations = [
      matchLocation('conf.d/editor.fish', 0, 7),
      matchLocation('conf.d/editor.fish', 0, 25),
    ];

    const LOCAL_EDITOR_MatchLocations = [
      matchLocation('conf.d/local-editor.fish', 0, 8),
      matchLocation('conf.d/local-editor.fish', 0, 26),
    ];

    describe("global 'EDITOR'", () => {
      let defNode: SyntaxNode;
      let queryNode: SyntaxNode;
      let globalEditorDoc: LspDocument;
      beforeEach(() => {
        globalEditorDoc = tw.find('conf.d/editor.fish')!;
        defNode = findDefNode(globalEditorDoc, 'EDITOR');
        queryNode = findQueryNode(globalEditorDoc, 'EDITOR');
      });

      it("global 'EDITOR' def", () => {
        const refs = analyzer.getReferences(globalEditorDoc, pointToPosition(defNode.startPosition));
        expectFoundLocationsToEqualMatchLocations(refs, GLOBAL_EDITOR_MatchLocations);
      });

      it("global 'EDITOR' ref", () => {
        const refs = analyzer.getReferences(globalEditorDoc, pointToPosition(queryNode.startPosition));
        expectFoundLocationsToEqualMatchLocations(refs, GLOBAL_EDITOR_MatchLocations);
        // local-editor should not be included
      });
    });

    describe("local 'EDITOR'", () => {
      let defNode: SyntaxNode;
      let queryNode: SyntaxNode;
      let localEditorDoc: LspDocument;
      beforeEach(() => {
        localEditorDoc = tw.find('conf.d/local-editor.fish')!;
        defNode = findDefNode(localEditorDoc, 'EDITOR');
        queryNode = findQueryNode(localEditorDoc, 'EDITOR');
      });

      it('local `EDITOR` def', () => {
        const refs = analyzer.getReferences(localEditorDoc, pointToPosition(defNode.startPosition));
        expectFoundLocationsToEqualMatchLocations(refs, LOCAL_EDITOR_MatchLocations);
      });

      it('local `EDITOR` ref', () => {
        const refs = analyzer.getReferences(localEditorDoc, pointToPosition(queryNode.startPosition));
        expectFoundLocationsToEqualMatchLocations(refs, LOCAL_EDITOR_MatchLocations);
      });
    });
  });
});

describe('universal/global variable references are position-independent', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
  });

  function refsOf(ws: TestWorkspace, line: number, character: number): Set<string> {
    const doc = ws.getDocument('conf.d/pw.fish')!;
    return new Set(
      analyzer.getReferences(doc, { line, character })
        .map(r => `${r.range.start.line}:${r.range.start.character}`),
    );
  }

  const ws = TestWorkspace.create().addFiles({
    relativePath: 'conf.d/pw.fish',
    content: [
      'echo $pw',          // 0  ref BEFORE any def (universal persists across sessions)
      'set -Ux pw $PWD',   // 1  def #1  (pw @ 8)
      'echo $pw',          // 2  ref between defs
      'set -Ux pw $PWD',   // 3  def #2  (pw @ 8)  <-- redefinition, NOT an erase
      'echo $pw',          // 4  ref after def #2
    ].join('\n'),
  }).initialize();

  it('refs from def#1, def#2, and a usage all return the same complete set', () => {
    const fromUsage = refsOf(ws, 2, 6);  // $pw on line 2
    const fromDef1 = refsOf(ws, 1, 8);   // set -Ux pw  (def #1)
    const fromDef2 = refsOf(ws, 3, 8);   // set -Ux pw  (def #2)

    // every read (0,2,4) must appear regardless of which occurrence is queried
    for (const set of [fromUsage, fromDef1, fromDef2]) {
      expect(set.has('0:6')).toBe(true); // pre-def read included (the bug: was dropped from def#2)
      expect(set.has('2:6')).toBe(true);
      expect(set.has('4:6')).toBe(true);
    }
    // position-independence: identical sets no matter where you click
    expect([...fromDef2].sort()).toEqual([...fromUsage].sort());
    expect([...fromDef1].sort()).toEqual([...fromUsage].sort());
  });
});

// `set -e foo[N]` erases a single list element, not the whole variable, so it
// must NOT end `foo`'s lifetime — references after it still bind to the def.
// (Full `set -e foo` / `set -el foo` does end a local variable's lifetime.)
describe('indexed erase does not end a variable lifetime', () => {
  setLogger();
  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
  });

  const ws = TestWorkspace.create().addFiles(
    {
      relativePath: 'functions/idx.fish',
      content: [
        'function idx',                    // 0
        '    set -l local_symbol 1 2 3 4', // 1  def @ 11
        '    set -e local_symbol[4]',      // 2  index erase — NOT a full erase
        '    set --show local_symbol',     // 3  ref @ 15 (must survive)
        'end',                             // 4
      ].join('\n'),
    },
    {
      relativePath: 'functions/full.fish',
      content: [
        'function full',                   // 0
        '    set -l v 1 2',                // 1  def @ 11
        '    set -el v',                   // 2  FULL local erase — ends lifetime
        '    set --show v',                // 3  ref @ 15 (should NOT bind to def)
        'end',                             // 4
      ].join('\n'),
    },
  ).initialize();

  it('keeps references after `set -e foo[N]` (index erase)', () => {
    const doc = ws.getDocument('functions/idx.fish')!;
    const refLines = new Set(
      analyzer.getReferences(doc, { line: 1, character: 11 }).map(r => r.range.start.line),
    );
    expect(refLines.has(1)).toBe(true); // def
    expect(refLines.has(2)).toBe(true); // the `set -e local_symbol[4]` target is still a ref
    expect(refLines.has(3)).toBe(true); // post-index-erase `set --show` still bound
  });

  it('still ends a LOCAL lifetime on a full `set -el foo`', () => {
    const doc = ws.getDocument('functions/full.fish')!;
    const refLines = new Set(
      analyzer.getReferences(doc, { line: 1, character: 11 }).map(r => r.range.start.line),
    );
    expect(refLines.has(1)).toBe(true); // def
    expect(refLines.has(3)).toBe(false); // after full local erase, line 3 no longer binds
  });
});

describe('server onReferences', () => {
  setLogger();

  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  describe('argv in regular caller + no-scope callee', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/caller.fish',
        content: [
          'function caller',
          '   set val_1 1',
          '   set val_2 2',
          '   set val_3 3',
          '   set val_4 4',
          '   called',
          '   set --show argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/called.fish',
        content: [
          'function called --no-scope-shadowing',
          '    set -f argv 1 2 3',
          '    set --show argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/outer.fish',
        content: [
          'function outer',
          '    caller',
          '    set --show argv',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('keeps argv references anchored to request position (includes caller+called, excludes outer)', async () => {
      const callerDoc = workspace.getDocument('functions/caller.fish')!;
      const calledDoc = workspace.getDocument('functions/called.fish')!;
      const outerDoc = workspace.getDocument('functions/outer.fish')!;

      const params: ReferenceParams = {
        context: { includeDeclaration: true },
        textDocument: { uri: calledDoc.uri },
        position: { line: 1, character: 11 }, // `argv` in: set -f argv 1 2 3
      };

      const refs = await server.onReferences(params);

      const callerRefLines = refs.filter(r => r.uri === callerDoc.uri).map(r => r.range.start.line);
      const calledRefLines = refs.filter(r => r.uri === calledDoc.uri).map(r => r.range.start.line);
      const outerRefLines = refs.filter(r => r.uri === outerDoc.uri).map(r => r.range.start.line);

      expect(callerRefLines).toContain(6);
      expect(calledRefLines).toContain(1);
      expect(calledRefLines).toContain(2);
      expect(outerRefLines).not.toContain(2);
    });
  });
});
