import * as os from 'os';
import * as Parser from 'web-tree-sitter';
import { containsRange, findEnclosingScope, getChildNodes, getRange } from '../src/utils/tree-sitter';
import { isCommandName, isCommandWithName, isComment, isFunctionDefinitionName, isIfStatement, isMatchingOption, isOption, isString, isTopLevelFunctionDefinition } from '../src/utils/node-types';
import { convertIfToCombinersString } from '../src/code-actions/combiner';
import { setLogger } from './helpers';
import { initializeParser } from '../src/parser';
import { findReturnNodes, getReturnStatusValue } from '../src/code-lens';
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../src/document';
import { SyntaxNode } from 'web-tree-sitter';
import { isReservedKeyword } from '../src/utils/builtins';
import { isAutoloadedUriLoadsFunctionName, shouldHaveAutoloadedFunction } from '../src/utils/translation';

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
      if test -f file || test -e file
          echo "file exists"
      else if test -d file
          echo "file is a directory"
      else
        echo "file does not exist"
      end`,
        expected: `test -f file || test -e file
and echo "file exists"

or test -d file
and echo "file is a directory"

or echo "file does not exist"`,
      },
    ];

    tests.forEach(({ name, input, expected }) => {
      it(name, async () => {
        const tree = parser.parse(input);
        const root = tree.rootNode;
        const node = getChildNodes(root).find(n => isIfStatement(n));

        if (!node) fail();

        const combiner = convertIfToCombinersString(node);

        // console.log('-'.repeat(50));
        // console.log(combiner);
        // console.log('-'.repeat(50));

        expect(combiner).toBe(expected);
      });
    });
  });

  describe('Refactor Function Tests', () => {
    it('Convert Refactor Function', async () => {
      const input = 'return 2';
      const rootNode = parser.parse(input).rootNode;
      const ret = findReturnNodes(rootNode).pop();
      if (!ret) fail();
      expect(ret.text).toEqual('return 2');
      expect(getReturnStatusValue(ret)).toEqual({
        inlineValue: 'Misuse of shell builtins',
        tooltip: { code: '2', description: 'Misuse of shell builtins' },
      });
    });
  });

  describe('Refactor Function Tests', () => {
    describe('autoloaded tests', () => {
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

      tests.forEach(({ name, uri, input, expected }) => {
        it(name, async () => {
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
          // console.log({
          //   name,
          //   autoloadType: doc.getAutoloadType(),
          //   unusedLocalFunction: unusedLocalFunction.map(n => n.text),
          //   localFunctionCalls: localFunctionCalls.map(n => n.text),
          //   localFunctions: localFunctions.map(n => n.text),
          // });

          expect({
            autoloadType: doc.getAutoloadType(),
            unusedLocalFunction: unusedLocalFunction.map(n => n.text),
            localFunctions: localFunctions.map(n => n.text),
          }).toMatchObject(expected);
        });
      });
    });
  });
});
export type LocalFunctionCallType = {
  node: SyntaxNode;
  text: string;
};

function isMatchingCompletionOption(node: SyntaxNode) {
  return isMatchingOption(node, { shortOption: '-n', longOption: '--condition' })
    || isMatchingOption(node, { shortOption: '-a', longOption: '--arguments' })
    || isMatchingOption(node, { shortOption: '-c', longOption: '--command' });
}
