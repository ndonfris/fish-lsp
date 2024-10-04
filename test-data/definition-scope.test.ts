
import Parser, { SyntaxNode } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { createFakeCursorLspDocument, createFakeLspDocument, setLogger } from './helpers';
import { Simple } from './simple';
import {
  FishDocumentSymbol,
  flattenNested,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import { execEscapedSync } from '../src/utils/exec';
import { initializeParser } from '../src/parser';
import { isCommandName, isEndStdinCharacter, isFunctionDefinition, isMatchingOption, isOption, isProgram, isString, isVariable } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { findFirstParent, getChildNodes, getChildrenArguments, getNodeAtPosition, getRange, pointToPosition, positionToPoint } from '../src/utils/tree-sitter';

import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';
import { SymbolKind } from 'vscode-languageserver';
import { symbolKindToString } from '../src/utils/translation';
import { DefinitionScope } from '../src/utils/definition-scope';



describe('definition-scope test suite', () => {
  

  setLogger();

  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function testSymbolFiltering(filename: string, _input: string) {
    const { document, cursorPosition, input } = createFakeCursorLspDocument(filename, _input);
    const tree = parser.parse(document.getText());
    const { rootNode } = tree;
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(document.uri, rootNode);
    const flatSymbols = flattenNested(...symbols);
    const nodes = getChildNodes(rootNode);
    let cursorNode = getNodeAtPosition(tree, cursorPosition)!;
    let fixedCursorPos = cursorPosition;
    if (cursorNode.text.startsWith('$')) {
      fixedCursorPos = { line: cursorPosition.line, character: cursorPosition.character + 1 };
      cursorNode = getNodeAtPosition(tree, fixedCursorPos)!;
    }
    // console.log({ flatSymbolsNames: flatSymbols.map(s => s.name) });
    analyzer.analyze(document);
    return {
      symbols,
      flatSymbols,
      tree: tree,
      rootNode,
      nodes,
      doc: document,
      cursorPosition: fixedCursorPos,
      cursorNode,
      input,
    };
  }
  it('check definition scope', () => {
    const { rootNode, doc /*, cursorPosition, cursorNode*/ } = testSymbolFiltering('conf.d/beep.fish', [
      'function notify',
      '    set -l job (jobs -l -g)',
      '    or begin; echo "There are no jobs" >&2; return 1; end',
      '    ',
      '    function _notify_job_$job --on-job-exit $job --inherit-variable job',
      '        echo -n \\a # beep',
      '        functions -e _notify_job_$job',
      '    end',
      'end',
      ''
    ].join('\n'));

    analyzer.analyze(doc);

    let lastPosition: LSP.Position
    getChildNodes(rootNode).forEach(node => {
      if (node.text === 'job') {
        lastPosition = pointToPosition(node.startPosition);
        // console.log(Simple.node(node));
      }
    });

    console.log({ lastPosition });
    const defSymbol = analyzer.getDefinitionSymbol(doc, lastPosition);
    // const curr = rootNode.descendantForPosition(lastPosition);
    const nodes = getChildNodes(defSymbol.pop().scope.scopeNode).filter(s => s.text === 'job')
    nodes.forEach((s, i) => console.log(i, Simple.node(s)));
    // console.log({node: Simple.symbol(defSymbol)});

    const refSymbols = analyzer.getReferences(doc, lastPosition);
    refSymbols.forEach(s => console.log(Simple.location(s)));
    // console.log();

    // expect(refSymbols.length).toEqual(5);
  });

  it('check definition scope 2', () => {
    const { nodes, rootNode, doc, cursorPosition, /*cursorNode*/ } = testSymbolFiltering('conf.d/beep.fish', [
      'function notify',
      '    set -l job (jobs -l -g)',
      '    or begin; echo "There are no jobs" >&2; return 1; end',
      '    ',
      '    function _notify_job_$job --on-job-exit $job --inherit-variable job',
      '        echo -n \\a # beep',
      '        functions -e _notify_job_$job',
      '    end',
      '    function skip',
      '        echo -n \\skip$job# skip 1',
      '    end',
      'end',
      'function aaaa',
      '    echo -n $job█ # skip 2',
      'end',
      ''
    ].join('\n'));

    analyzer.analyze(doc);
    const local = analyzer.findLocalLocations(doc, cursorPosition);
    local.forEach(s => console.log(Simple.location(s)));


    // getChildNodes(rootNode).filter(n => {
    //   if (isFunctionDefinition(n)) {
    //     return getChildrenArguments(n).some((opt: SyntaxNode) => (
    //       isMatchingOption(opt, { shortOption: '-S', longOption: '----no-scope-shadowing' }) ||
    //       (isMatchingOption(opt, { shortOption: '-V', longOption: '--inherit-variable' }) && opt?.nextNamedSibling?.text === 'job') ||
    //       (isMatchingOption(opt, { shortOption: '-v', longOption: '--on-variable' }) && opt?.nextNamedSibling?.text === 'job')
    //     ));
    //   }
    //   return true
    // }).filter(n => isFunctionDefinition(n))
    //   .forEach((n, i) => {
    //   console.log(i, Simple.node(n));
    // })

  })


})