import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import { TextDocumentItem, Location } from 'vscode-languageserver';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { CurrentWorkspace, currentWorkspace, Workspace, workspaces } from '../src/utils/workspace';
import { flattenNested } from '../src/utils/flatten';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { Analyzer } from '../src/analyze';

export function setLogger(
  beforeCallback: () => Promise<void> = async () => { },
  afterCallback: () => Promise<void> = async () => { },
) {
  const jestConsole = console;
  beforeEach(async () => {
    global.console = require('console');
    await beforeCallback();
  });
  afterEach(async () => {
    global.console = jestConsole;
    await afterCallback();
  });
}

/**
 * @param {string} fname - relative path to file, in test-data folder
 * @param {boolean} inAutoloadPath - simulate the doc uri being in ~/.config/fish/functions/*.fish
 * @returns {LspDocument} - lsp document (from '../src/document.ts')
 */
export function resolveLspDocumentForHelperTestFile(fname: string, inAutoloadPath: boolean = true): LspDocument {
  // check which path type is fname -----------> absolute path  | relative path
  const filepath = fname.startsWith(homedir()) ? resolve(fname) : resolve(__dirname, fname);
  const file = readFileSync(filepath, 'utf8');
  const filename = inAutoloadPath ? `file://${homedir()}/.config/fish/functions/${fname.split('/').at(-1)}` : `file://${filepath}`;
  const doc = TextDocumentItem.create(filename, 'fish', 0, file);
  return new LspDocument(doc);
}

export async function resolveAbsPath(fname: string): Promise<string[]> {
  const file = readFileSync(resolve(fname), 'utf8');
  return file.split('\n');
}

export function positionStr(pos: Point) {
  return `{ row: ${pos.row.toString()}, column: ${pos.column.toString()} }`;
}

export async function parseFile(fname: string): Promise<Tree> {
  const text = await resolveAbsPath(fname);
  const parser = await initializeParser();
  const tree = parser.parse(text.join('\n'));
  return tree;
}

export function createFakeUriPath(path: string): string {
  if (path.startsWith('/')) {
    return `file://${path}`;
  }
  return `file://${homedir()}/.config/fish/${path}`;
}

export type TestLspDocument = {
  path: string;
  text: string | string[];
};

export function createTestWorkspace(
  analyzer: Analyzer,
  ...docs: TestLspDocument[]
) {
  const result: LspDocument[] = [];
  for (const doc of docs) {
    const newDoc = createFakeLspDocument(doc.path, ...Array.isArray(doc.text) ? doc.text : [doc.text]);
    analyzer.analyze(newDoc);
    result.push(newDoc);
  }
  return result;
}

export function createFakeLspDocument(name: string, ...text: string[]): LspDocument {
  const uri = createFakeUriPath(name);
  const doc = LspDocument.createTextDocumentItem(uri, text.join('\n'));
  // get the current workspace, if it exists, otherwise create a test workspace
  const workspace: Workspace = currentWorkspace?.findWorkspace(uri) || Workspace.createTestWorkspaceFromUri(uri);
  // Add the uri to the workspace if it isn't already there and it should be
  // This is to ensure that test workspaces group similar files together
  if (workspace.shouldContain(uri)) {
    workspace.add(uri);
  }
  // add the workspace to the `workspaces` array if it doesn't already exist
  if (!workspaces.some(ws => ws.uri === workspace.uri)) {
    workspaces.push(workspace);
  }
  // update currentWorkspace.current with the new workspace
  currentWorkspace.updateWorkspace(workspace);
  return doc;
}

export function setupTestCallback(parser: Parser) {
  return function setupTestDocument(name: string, ...text: string[]): {
    doc: LspDocument;
    input: string;
    tree: Tree;
    root: SyntaxNode;
  } {
    const input = text.join('\n');
    const doc = createFakeLspDocument(name, input);
    const tree = parser.parse(input);
    const root = tree.rootNode;
    return { doc, tree, root, input };
  };
}

export function getAllTypesOfNestedArrays(doc: LspDocument, root: SyntaxNode) {
  const allNodes: SyntaxNode[] = getChildNodes(root);
  const allNamedNodes: SyntaxNode[] = getNamedChildNodes(root);
  const nodes: SyntaxNode[] = flattenNested(root);
  const flatNodes: SyntaxNode[] = flattenNested(root);
  const symbols: FishSymbol[] = processNestedTree(doc, root);
  const flatSymbols: FishSymbol[] = flattenNested(...symbols);

  return {
    allNodes,
    allNamedNodes,
    nodes,
    flatNodes,
    symbols,
    flatSymbols,
  };
}



export type PrintClientTreeOpts = { log: boolean; };

/**
 * Will print the client tree of document definition symbols  
 */
export function printClientTree(
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


export function locationAsString(loc: Location): string[] {
  return [
    loc.uri,
    ...[loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character].map(s => s.toString())
  ];

}

export function fakeDocumentTrimUri(doc: LspDocument): string {
  if (['conf.d', 'functions', 'completions'].includes(doc.getAutoloadType())) {
    return [doc.getAutoloadType(), doc.getFileName()].join('/');
  }
  if ('config' === doc.getAutoloadType()) {
    return doc.getFileName()
  }
  return doc.getFileName();
}
