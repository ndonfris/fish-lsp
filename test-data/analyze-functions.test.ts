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
import { CompleteFlag, findFlagsToComplete, buildCompleteString } from '../src/code-actions/argparse-completions';
import { Analyzer } from '../src/analyze';
import { filterGlobalSymbols } from '../src/document-symbol';

let parser: Parser;
let analyzer: Analyzer;

describe('Analyze functions in conf.d', () => {
  setLogger();
  beforeAll(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });
  beforeEach(async () => {
    parser.reset();
  });

  const tests = [
    {
      name: 'simple function',
      input: `
function foo
    echo foo
end`,
      uri: 'file:///home/user/.config/fish/conf.d/foo.fish',
    },
    {
      name: 'functions/bar.fish',
      input: `
function bar
    echo 'bar'
end`,
      uri: 'file:///home/user/.config/fish/functions/bar.fish',
    },
    {
      name: 'function with other function',
      input: `
function foo
  foo_1
  foo_2
  foo_3
end

function foo_1
    echo foo_1
end


function foo_2
    echo foo_2
end

function foo_3
    echo foo_3
end`,
      uri: 'file:///home/user/.config/fish/conf.d/__foo.fish',
    },
    {
      name: 'function /tmp/foo.fish',
      input: `
function foo
    echo foo
end

foo`,
      uri: 'file:///tmp/foo.fish',
    },
  ];

  tests.forEach(({ name, input, uri }) => {
    if (name !== 'function /tmp/foo.fish') return;
    it(name, () => {
      console.log('-'.repeat(80));
      console.log(name);
      console.log('='.repeat(80));
      const tree = parser.parse(input);
      const rootNode = tree.rootNode;
      const textDocument = TextDocumentItem.create(uri, 'fish', 1, input);
      const doc = new LspDocument(textDocument);
      analyzer.analyze(doc);
      console.log('rootNode', rootNode.text);

      const symbols = analyzer.getDocumentSymbols(doc.uri);

      const globalSymbols = filterGlobalSymbols(symbols);
      const ws = analyzer.getWorkspaceSymbols('foo_1');
      let position = { line: 0, character: 0 };
      for (const node of getChildNodes(rootNode)) {
        if (isCommandWithName(node, 'foo')) {
          position = getRange(node).end;
          break;
        }
      }
      const definition = analyzer.getDefinition(doc, position);
      console.log('definition', definition);
      console.log('position', position);
      console.log('symbols', symbols.map(s => {
        return {
          name: s.name,
          scope: s.scope.scopeTag,
        };
      }));
      console.log('globalsymbols', globalSymbols.map(s => s.name));
      console.log('workspace_symbols', ws.map(s => s.name));
      console.log('-'.repeat(80));

      // const functions = nodes.filter(isTopLevelFunctionDefinition);
      // expect(functions.length).toBeGreaterThan(0);
    });
  });
});
