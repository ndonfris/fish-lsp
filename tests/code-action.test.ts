import * as os from 'os';
import * as Parser from 'web-tree-sitter';
import { containsRange, findEnclosingScope, getChildNodes, getRange } from '../src/utils/tree-sitter';
import { isCommandName, isCommandWithName, isComment, isFunctionDefinitionName, isIfStatement, isMatchingOption, isOption, isString, isTopLevelFunctionDefinition } from '../src/utils/node-types';
import { Option } from '../src/parsing/options';
import { convertIfToCombinersString } from '../src/code-actions/combiner';
import { setLogger, fail, createMockConnection, setupStartupMock } from './helpers';
import { initializeParser } from '../src/parser';
import { findReturnNodes, getReturnStatusValue } from '../src/inlay-hints';
import { DidDeleteFilesNotification, TextDocumentItem } from 'vscode-languageserver';
import { documents, LspDocument } from '../src/document';
import { SyntaxNode } from 'web-tree-sitter';
import { isReservedKeyword } from '../src/utils/builtins';
import { isAutoloadedUriLoadsFunctionName, shouldHaveAutoloadedFunction } from '../src/utils/translation';
import { CompleteFlag, findFlagsToComplete, buildCompleteString } from '../src/code-actions/argparse-completions';
import { Analyzer, analyzer } from '../src/analyze';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { codeActionHandlers } from '../src/code-actions/code-action-handler';
import { testOpenDocument } from './document-test-helpers';
import FishServer, { currentDocument } from '../src/server';
import { connection } from '../src/utils/startup';
import { logger } from '../src/logger';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { createConnection } from 'net';
import { Workspace } from '../src/utils/workspace';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';

let parser: Parser;

describe('Code Action Tests', () => {
  setLogger();
  beforeAll(async () => {
    parser = await initializeParser();
  });
  beforeEach(async () => {
    parser.reset();
  });

  describe('Refactor Combiner Tests', () => {
    const tests = [
      {
        name: 'Convert Refactor `if`',
        input: `
      if test -f file
          echo "file exists"
      end`,
        expected: `test -f file
and echo "file exists"`,
      },
      {
        name: 'Convert Refactor `if` with `else`',
        input: `
      if test -f file
          echo "file exists"
      else
          echo "file does not exist"
          # comment
          echo 'exiting'
      end`,
        expected: `test -f file
and echo "file exists"

or echo "file does not exist"
# comment
and echo 'exiting'`,
      },
      {
        name: 'Convert Refactor `if` with `else if`',
        input: `
      if test -f file
          echo "file exists"
      else if test -d file
          echo "file is a directory" &> /dev/null
      end`,
        expected: `test -f file
and echo "file exists"

or test -d file
and echo "file is a directory" &> /dev/null`,
      },
      {
        name: 'Convert Refactor `if` with `else if` and `else`',
        input: `
      if not test -f file || test -e file
          echo "file exists"
      else if test -d file
          echo "file is a directory"
      else
        echo "file does not exist"
      end`,
        expected: `not test -f file || test -e file
and echo "file exists"

or test -d file
and echo "file is a directory"

or echo "file does not exist"`,
      },
      {
        name: 'Convert Refactor negated `if` with `else if` and `else`',
        input: `if ! test -e file && ! test -f file
    # comment blah blah
    echo "file is not executable"
else if not test -f file
    echo "file exists"
else if ! test -d file
    echo "file is a directory"
else
  echo "file does not exist"
end`,
        expected: `! test -e file && ! test -f file
# comment blah blah
and echo "file is not executable"

or not test -f file
and echo "file exists"

or ! test -d file
and echo "file is a directory"

or echo "file does not exist"`,
      },
    ];

    tests.forEach(({ name, input, expected }) => {
      it.skip(name, async () => {
        const tree = parser.parse(input);
        const root = tree.rootNode;
        const node = getChildNodes(root).find(n => isIfStatement(n));

        if (!node) fail();
        const combiner = convertIfToCombinersString(node!);

        expect(combiner).toBe(expected);
      });
    });
  });

  describe('Refactor Function Tests', () => {
    it.skip('Convert Refactor Function', async () => {
      const input = 'return 2';
      const rootNode = parser.parse(input).rootNode;
      const ret = findReturnNodes(rootNode).pop();
      if (!ret) fail();
      expect(ret!.text).toEqual('return 2');
      expect(getReturnStatusValue(ret!)).toEqual({
        inlineValue: 'Misuse of shell builtins',
        tooltip: { code: '2', description: 'Misuse of shell builtins' },
      });
    });
  });

  describe('Refactor Function Tests', () => {
    describe('autoloaded tests', async () => {
      const tests = [
        {
          name: 'is autoloaded function without errors',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util --description 'autoloaded file'
  echo "autoloaded file"
end`,
          expected: {
            autoloadType: 'functions',
            isMissingAutoloadedFunction: false,
            isMissingAutoloadedFunctionButContainsOtherFunctions: false,
            reservedFunctionNames: [],
          },
        },
        {
          name: 'autoloaded function does not have a function definition for its filename',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function not_util --description 'autoloaded file'
  function util --description "nested function which shouldn't count"
    echo 'function shadowing with the same name is not relevant'
  end
  echo "autoloaded file"
end`,
          expected: {
            autoloadType: 'functions',
            isMissingAutoloadedFunction: true,
            isMissingAutoloadedFunctionButContainsOtherFunctions: true,
            reservedFunctionNames: [],
          },
        },
        {
          name: 'autoloaded function with errors',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: '',
          expected: {
            autoloadType: 'functions',
            isMissingAutoloadedFunction: true,
            isMissingAutoloadedFunctionButContainsOtherFunctions: false,
            reservedFunctionNames: [],
          },
        },
        {
          name: 'not autoloaded function without errors',
          uri: `file://${os.homedir()}/.config/fish/completions/no_functions.fish`,
          input: '',
          expected: {
            autoloadType: 'completions',
            isMissingAutoloadedFunction: false,
            isMissingAutoloadedFunctionButContainsOtherFunctions: false,
            reservedFunctionNames: [],
          },
        },
        {
          name: 'autoloaded function with naming errors',
          uri: `file://${os.homedir()}/.config/fish/config.fish`,
          input: `
function set --description 'set function is a builtin'
    set $argv
end
function command --description 'command function is a builtin'
    command $argv
end
function function --description 'function function is a builtin'
    echo 'function' $argv
end
function valid_name --description 'valid name'
    function break --description 'break is a builtin'
        echo 'invalid name'
    end
end`,
          expected: {
            autoloadType: 'config',
            isMissingAutoloadedFunction: false,
            isMissingAutoloadedFunctionButContainsOtherFunctions: false,
            reservedFunctionNames: ['set', 'command', 'function', 'break'],
          },
        },
      ];

      tests.forEach(async ({ name, uri, input, expected }) => {
        await it.skip(name, async () => {
          const tree = parser.parse(input);
          const root = tree.rootNode;
          const doc = new LspDocument(TextDocumentItem.create(uri, 'fish', 0, input));

          const topLevelFunctions: SyntaxNode[] = [];
          const autoloadedFunctions: SyntaxNode[] = [];
          const isAutoloadedFunctionName = isAutoloadedUriLoadsFunctionName(doc);

          const functionsWithReservedKeyword: SyntaxNode[] = [];

          for (const node of getChildNodes(root)) {
            if (!node.parent) continue;
            if (isFunctionDefinitionName(node)) {
              if (isAutoloadedFunctionName(node)) autoloadedFunctions.push(node);
              if (isTopLevelFunctionDefinition(node)) topLevelFunctions.push(node);
              if (isFunctionDefinitionName(node) && isReservedKeyword(node.text)) {
                functionsWithReservedKeyword.push(node);
              }
            }
            continue;
          }

          /** only functions files can have missing autoloaded functions */
          const isMissingAutoloadedFunction = shouldHaveAutoloadedFunction(doc)
            ? autoloadedFunctions.length === 0
            : false;

          const isMissingAutoloadedFunctionButContainsOtherFunctions =
            isMissingAutoloadedFunction && topLevelFunctions.length > 0;

          expect({
            autoloadType: doc.getAutoloadType(),
            isMissingAutoloadedFunction,
            isMissingAutoloadedFunctionButContainsOtherFunctions,
            reservedFunctionNames: functionsWithReservedKeyword.map(n => n.text),
          }).toMatchObject(expected);
        });
      });
    });

    describe('local functions', () => {
      const tests = [
        {
          name: 'local function is unused',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util
  function inner

  end
end`,
          expected: {
            autoloadType: 'functions',
            unusedLocalFunction: ['inner'],
            localFunctions: ['inner'],
          },
        },
        {
          name: 'local function is used',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util
  function inner

  end
  inner
end`,
          expected: {
            autoloadType: 'functions',
            unusedLocalFunction: [],
            localFunctions: ['inner'],
          },
        },
        {
          name: 'local helper function is unused',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util
  function inner
  end
  inner
end

function __helper
end`,
          expected: {
            autoloadType: 'functions',
            unusedLocalFunction: ['__helper'],
            localFunctions: ['inner', '__helper'],
          },
        },
        {
          name: 'local helper function is used',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util
  function inner
  end
  inner
  __helper
end

function __helper
end`,
          expected: {
            autoloadType: 'functions',
            unusedLocalFunction: [],
            localFunctions: ['inner', '__helper'],
          },
        },
        {
          name: 'local helper completion function is used with nested functions',
          uri: `file://${os.homedir()}/.config/fish/completions/util.fish`,
          input: `
function util_cmp
    echo 'a\t"a"
    b\t"b" 
    c\t"c"'
end

complete -c util -a '(util_cmp; or other_cmps)'`,
          expected: {
            autoloadType: 'completions',
            unusedLocalFunction: [],
            localFunctions: ['util_cmp'],
          },
        },
      ];

      tests.forEach(({ name, uri, input, expected }) => {
        it(name, async () => {
          const tree = parser.parse(input);
          const root = tree.rootNode;
          const doc = new LspDocument(TextDocumentItem.create(uri, 'fish', 0, input));

          const isAutoloadedFunctionName = isAutoloadedUriLoadsFunctionName(doc);

          const localFunctions: SyntaxNode[] = [];
          const localFunctionCalls: LocalFunctionCallType[] = [];
          for (const node of getChildNodes(root)) {
            if (isFunctionDefinitionName(node) && !isAutoloadedFunctionName(node)) {
              localFunctions.push(node);
            }
            if (isCommandName(node)) {
              localFunctionCalls.push({ node, text: node.text });
            }
            if (doc.getAutoloadType() === 'completions') {
              if (isComment(node)) continue;
              if (isOption(node)) continue;
              if (node.parent && isCommandWithName(node.parent, 'complete')) {
                if (node.previousSibling && isMatchingCompletionOption(node.previousSibling)) {
                  if (isString(node)) {
                    localFunctionCalls.push({
                      node,
                      text: node.text
                        .slice(1, -1)
                        .replace(/[()]/g, '')
                        .replace(/[^\x00-\x7F]/g, ''),
                    });
                  } else {
                    localFunctionCalls.push({ node, text: node.text });
                  }
                  continue;
                }
              }
            }
            continue;
          }

          const unusedLocalFunction = localFunctions.filter(localFunction => {
            const callableRange = getRange(findEnclosingScope(localFunction)!);
            return !localFunctionCalls.find(call => {
              const callRange = getRange(findEnclosingScope(call.node)!);
              return containsRange(callRange, callableRange) &&
                call.text.split(/[&<>;|! ]/)
                  .filter(cmd => !['or', 'and', 'not'].includes(cmd))
                  .some(t => t === localFunction.text);
            });
          });

          expect({
            autoloadType: doc.getAutoloadType(),
            unusedLocalFunction: unusedLocalFunction.map(n => n.text),
            localFunctions: localFunctions.map(n => n.text),
          }).toMatchObject(expected);
        });
      });
    });

    describe('completions', () => {
      const tests = [
        {
          name: 'completions file with no completions',
          uri: `file://${os.homedir()}/.config/fish/functions/util.fish`,
          input: `
function util
    argparse h/help a/arguments c/command 'i/ignore-unknown' 'stop-nonopt' 'v/value=' other= -- $argv
    or return 

end
`,
          expected: {
            completionFlags: [
              { shortOption: 'h', longOption: 'help' },
              { shortOption: 'a', longOption: 'arguments' },
              { shortOption: 'c', longOption: 'command' },
              { shortOption: 'i', longOption: 'ignore-unknown' },
              { longOption: 'stop-nonopt' },
              { shortOption: 'v', longOption: 'value' },
              { longOption: 'other' },
            ],
            completionText: `complete -c util -s h -l help
complete -c util -s a -l arguments
complete -c util -s c -l command
complete -c util -s i -l ignore-unknown
complete -c util -l stop-nonopt
complete -c util -s v -l value
complete -c util -l other`,
          },
        },
      ];

      tests.forEach(({ name, uri, input, expected }) => {
        it(name, async () => {
          const tree = parser.parse(input);
          const root = tree.rootNode;
          const doc = new LspDocument(TextDocumentItem.create(uri, 'fish', 0, input));
          const completions: CompleteFlag[] = [];
          for (const node of getChildNodes(root)) {
            if (isCommandWithName(node, 'argparse')) {
              const flags = findFlagsToComplete(node);
              completions.push(...flags);
            }
          }
          const builtCompletions = buildCompleteString(doc.getAutoLoadName(), completions);

          expect(completions).toEqual(expected.completionFlags);
          expect(builtCompletions).toBe(expected.completionText);
        });
      });
    });
  });
  describe('code-actions-handlers', () => {
    beforeEach(async () => {
      setLogger();
      logger.setConsole(global.console);
      logger.allowDefaultConsole();
      logger.setSilent(false);
      setupStartupMock();
    });

    const workspace = TestWorkspace.create().addFiles(
      TestFile.completion('myfunc', ''),
      TestFile.function('myfunc', `function myfunc
    argparse h/help c/command a/arguments -- $argv
    or return 1

    echo "myfunc"
end

function another_func
    echo "another func"
end`),
      TestFile.config(`
    echo "config file",
    'alias ll="ls -la"',
    `),
      TestFile.function('util', 'function util; echo "util"; end'),
    ).initialize();

    let confgDoc: LspDocument;
    let myFuncFDoc: LspDocument;
    let myFuncCDoc: LspDocument;
    let cmdLineDoc: LspDocument;
    let ws: Workspace;

    const onCodeActionCallback = codeActionHandlers().onCodeActionCallback;

    beforeAll(async () => {
      ws = workspace.workspace!;
      if (!ws) throw new Error('Workspace not initialized');
      confgDoc = workspace.find('config.fish')!;
      myFuncFDoc = workspace.find('functions/myfunc.fish')!;
      myFuncCDoc = workspace.find('completions/myfunc.fish')!;
      cmdLineDoc = workspace.find('command-line.fish')!;
      ws.uris.all.forEach(uri => {
        const doc = documents.get(uri);
        if (doc) analyzer.analyze(doc);
      });
      logger.setConnectionConsole(connection.console);
    });

    it('ensure docs', () => {
      expect(ws).toBeDefined();
      expect(myFuncFDoc).toBeDefined();
      expect(myFuncCDoc).toBeDefined();
      expect(confgDoc).toBeDefined();
      expect(cmdLineDoc).toBeDefined();
    });

    it('can build completions for function', async () => {
      const doc = myFuncFDoc;
      const { root } = analyzer.analyze(doc).ensureParsed();
      const diagnostics = await getDiagnosticsAsync(root, doc);
      analyzer.diagnostics.setForTesting(doc.uri, diagnostics);
      const req = {
        textDocument: { uri: doc.uri },
        range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } },
        context: { diagnostics: [...analyzer.diagnostics.get(doc.uri) ?? []] },
      };
      const actions = await onCodeActionCallback(req);
      const completionActions = actions.filter(action => {
        return action.title.startsWith('Create completions for');
      });
      expect(completionActions.length).toBeGreaterThanOrEqual(1);
    });

    it('can generate argparse completions for command-line buffer', async () => {
      const commandLineBufferContent = `function test_cmd
    argparse h/help v/verbose d/debug o/output= -- $argv
    or return 1

    echo "test command"
end`;

      const commandLineDoc = new LspDocument(
        TextDocumentItem.create(
          'file:///tmp/fish.12345/command-line.fish',
          'fish',
          0,
          commandLineBufferContent,
        ),
      );

      expect(commandLineDoc.isCommandlineBuffer()).toBe(true);
      expect(commandLineDoc.getAutoloadType()).toBe('conf.d');

      testOpenDocument(commandLineDoc);
      analyzer.analyze(commandLineDoc).ensureParsed();

      const codeActions = await onCodeActionCallback({
        textDocument: { uri: commandLineDoc.uri },
        range: { start: { line: 1, character: 4 }, end: { line: 1, character: 12 } },
        context: { diagnostics: [], only: ['quickfix'] },
      });

      const argparseAction = codeActions.find(action =>
        action.title.includes('Create completions for'),
      );

      expect(argparseAction).toBeDefined();
      expect(argparseAction?.title).toContain('test_cmd');

      const edits = argparseAction?.edit?.documentChanges?.[0];
      if (edits && 'edits' in edits) {
        const insertText = edits.edits[0]?.newText;
        expect(insertText).toContain('complete -c test_cmd -s h -l help');
        expect(insertText).toContain('complete -c test_cmd -s v -l verbose');
        expect(insertText).toContain('complete -c test_cmd -s d -l debug');
        expect(insertText).toContain('complete -c test_cmd -s o -l output');
      } else {
        fail();
      }
    });

    it('should fix all argparse unused diagnostic issues in one code action', async () => {
      const doc = myFuncFDoc;
      const { root } = analyzer.analyze(doc).ensureParsed();
      const diagnostics = await getDiagnosticsAsync(root, doc);
      analyzer.diagnostics.setForTesting(doc.uri, diagnostics);

      const req = {
        textDocument: { uri: doc.uri },
        range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
        context: { diagnostics: [...analyzer.diagnostics.get(doc.uri) ?? []] },
      };

      const actions = await onCodeActionCallback(req);
      const fixAllAction = actions.find(action => action.kind === 'quickfix.fixAll');

      expect(fixAllAction).toBeDefined();
      expect(fixAllAction?.title).toContain('Fix all auto-fixable quickfixes');
      expect(fixAllAction?.edit?.changes).toBeDefined();

      const changes = fixAllAction!.edit!.changes!;
      const edits = changes[doc.uri];

      expect(edits).toHaveLength(3);

      const editTexts = edits?.map(e => e.newText) || [];
      expect(editTexts.some(text => text.includes('if set -ql _flag_help'))).toBe(true);
      expect(editTexts.some(text => text.includes('if set -ql _flag_command'))).toBe(true);
      expect(editTexts.some(text => text.includes('if set -ql _flag_arguments'))).toBe(true);

      editTexts.forEach(text => {
        expect(text).toContain('if set -ql');
        expect(text).toContain('end');
      });
    });
  });
});
export type LocalFunctionCallType = {
  node: SyntaxNode;
  text: string;
};

function isMatchingCompletionOption(node: SyntaxNode) {
  return isMatchingOption(node, Option.create('-c', '--command').withValue())
    || isMatchingOption(node, Option.create('-a', '--arguments').withMultipleValues())
    || isMatchingOption(node, Option.create('-n', '--condition').withValue());
}

