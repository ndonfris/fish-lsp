import { homedir } from 'os';
// import { assert } from "chai";
import { resolveLspDocumentForHelperTestFile, setLogger } from './helpers';
import { DocumentSymbol, Position } from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { Analyzer } from '../src/analyze';
import { FishWorkspace } from '../src/utils/workspace';
import { findDefinitionSymbols } from '../src/workspace-symbol';

let parser: Parser;
let analyzer: Analyzer;
const allPaths: string[] = [];
const symbols: DocumentSymbol[] = [];
const loggedAmount: number = 0;
const workspaces: FishWorkspace[] = [];
const jestConsole = console;

function analyzeConfigDocument() {
  const doc = resolveLspDocumentForHelperTestFile(
    `${homedir()}/.config/fish/config.fish`,
  );
  analyzer.analyze(doc);
  return { doc: doc, analyzer: analyzer };
}

setLogger(
  async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
    //await analyzer.initiateBackgroundAnalysis()
  },
  async () => {
    parser.reset();
  },
);

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe('analyze tests', () => {
  it('should analyze a document', async () => {
    const document = resolveLspDocumentForHelperTestFile(
      `${homedir()}/.config/fish/functions/test-fish-lsp.fish`,
      true,
    );
    analyzer.analyze(document);
    const pos = Position.create(78, 10);
    const defs = findDefinitionSymbols(analyzer, document, pos);
    console.log(defs);
    expect(true).toBe(true);
  });
});

function createTestRange(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}