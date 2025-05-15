import { Parsers, Option, ParsingDefinitionNames, DefinitionNodeNames } from '../src/parsing/barrel';
import { execAsyncF } from '../src/utils/exec';

import { initializeParser } from '../src/parser';
import { createFakeLspDocument, createTestWorkspace, setLogger } from './helpers';
// import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../src/utils/node-types';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { processAliasCommand } from '../src/parsing/alias';
import { flattenNested } from '../src/utils/flatten';
import { isCommandWithName, isEndStdinCharacter, isFunctionDefinition } from '../src/utils/node-types';
import { LongFlag, ShortFlag } from '../src/parsing/options';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { SymbolKind } from 'vscode-languageserver';
import { md } from '../src/utils/markdown-builder';
// import { isFunctionDefinitionName } from '../src/parsing/function';
import { getExpandedSourcedFilenameNode, isExistingSourceFilenameNode, isSourcedFilename, isSourceCommandName, isSourceCommandWithArgument, isSourceCommandArgumentName } from '../src/parsing/source';
import { SyncFileHelper } from '../src/utils/file-operations';
import * as Diagnostics from '../src/diagnostics/node-types';
import { Analyzer } from '../src/analyze';
import { groupCompletionSymbolsTogether, isCompletionCommandDefinition, getCompletionSymbol, processCompletion, CompletionSymbol } from '../src/parsing/complete';
import { getGlobalArgparseLocations, isGlobalArgparseDefinition } from '../src/parsing/argparse';
import { Workspace } from '../src/utils/workspace';
import { workspaces } from '../src/utils/workspace-manager';
import { LspDocument } from '../src/document';
import { buildExportDetail, extractExportVariable, findVariableDefinitionNameNode, isExportDefinition, isExportVariableDefinitionName, processExportCommand } from '../src/parsing/export';

let analyzer: Analyzer;
let parser: Parser;
type PrintClientTreeOpts = { log: boolean; };
function printClientTree(
  opts: PrintClientTreeOpts = { log: true },
  ...symbols: FishSymbol[]
): string[] {
  const result: string[] = [];

  function logAtLevel(indent = '', ...remainingSymbols: FishSymbol[]) {
    const newResult: string[] = [];
    remainingSymbols.forEach(n => {
      if (opts.log) {
        console.log(`${indent}${n.name} --- ${n.fishKind} --- ${n.scope.scopeTag} --- ${n.scope.scopeNode.firstNamedChild?.text}`);
      }
      newResult.push(`${indent}${n.name}`);
      newResult.push(...logAtLevel(indent + '    ', ...n.children));
    });
    return newResult;
  }
  result.push(...logAtLevel('', ...symbols));
  return result;
}
let text = '';
let rootNode: SyntaxNode;
let doc: LspDocument;
describe('parsing `export` variable defs', () => {
  setLogger();
  beforeEach(async () => {
    setupProcessEnvExecFile();
    parser = await initializeParser();
    await setupProcessEnvExecFile();
  });

  describe('test checking functions', () => {
    describe('(SyntaxNode) => boolean', () => {
      beforeEach(() => {
        parser.reset();
        text = [
          'export foo=bar',
          'export baz="b a z"',
        ].join('\n');
        doc = createFakeLspDocument('functions/test.fish', text);
        rootNode = parser.parse(text).rootNode;
      });

      it('isExportDefinition', () => {
        const results = getChildNodes(rootNode).filter(c => isExportDefinition(c));
        expect(results.length).toBe(2);
      });

      it('isExportVariableDefinitionName', () => {
        const results = getChildNodes(rootNode).filter(c => isExportVariableDefinitionName(c));
        expect(results.length).toBe(2);
        console.log('results', results.map(r => r.text));
      });
    });

    describe('extractExportVariable', () => {
      beforeEach(() => {
        parser.reset();
        text = [
          'export foo=bar',
          'export baz=\'b a z\'',
          'export qux="q u x"',
          'export quux=(q u u x)',
        ].join('\n');
        doc = createFakeLspDocument('functions/test.fish', text);
        rootNode = parser.parse(text).rootNode;
      });

      it('should extract export variable', () => {
        const results = getChildNodes(rootNode).filter(c => isExportVariableDefinitionName(c));
        expect(results.length).toBe(4);
        const varDefNode = results.at(0) as SyntaxNode;
        const varInfo = extractExportVariable(varDefNode);
        expect(varInfo).toBeDefined();
        if (varInfo) {
          expect(varInfo.name).toBe('foo');
          expect(varInfo.value).toBe('bar');
          console.log({
            name: varInfo.name,
            value: varInfo.value,
            start: varInfo.nameRange.start,
            end: varInfo.nameRange.end,
          });
          expect(varInfo.name).toBe('foo');
          expect(varInfo.value).toBe('bar');
          expect(varInfo.nameRange).toBeDefined();
          expect(varInfo.nameRange.start.line).toBe(0);
          expect(varInfo.nameRange.end.line).toBe(0);
        }
      });

      it('should extract export variable with spaces', () => {
        const results = getChildNodes(rootNode).filter(c => isExportVariableDefinitionName(c));
        expect(results.length).toBe(4);
        // const varFoo = results.at(0);
        // const varBaz = results.at(1);
        // const varQux = results.at(2);
        results.forEach((varDefNode, index) => {
          const extractedVarInfo = extractExportVariable(varDefNode);
          expect(extractedVarInfo).toBeDefined();
          console.log({
            index,
            ...extractedVarInfo,
          });
        });
      });

      it('show details', () => {
        const nodes = rootNode.descendantsOfType('command').filter(c => c.firstChild && c.firstNamedChild?.text === 'export');
        const result: FishSymbol[] = [];
        nodes.forEach((node, index) => {
          const symbol = processExportCommand(doc, node).at(0);
          if (!symbol) {
            return;
          }
          result.push(symbol);
          console.log({
            index,
            symbol: {
              name: symbol.name,
              scope: symbol.scope.scopeTag,
              focusedNode: symbol.focusedNode.text,
              selectionRange: [symbol.selectionRange.start.line, symbol.selectionRange.start.character, symbol.selectionRange.end.line, symbol.selectionRange.end.character],
              detail: symbol.detail,
            },
          });
        });
        expect(result).toHaveLength(4);
      });

      it('processTree', () => {
        const nestedTree = processNestedTree(doc, rootNode);
        const symbols = flattenNested(...nestedTree);
        expect(symbols).toHaveLength(4);
      });
    });
  });
});
