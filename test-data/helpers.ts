import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeParser } from '../src/parser';
import Parser, { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { Workspace, workspaces } from '../src/utils/workspace';

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

export function createFakeLspDocument(name: string, text: string): LspDocument {
  const uri = createFakeUriPath(name);
  const doc = TextDocumentItem.create(uri, 'fish', 0, text);
  const workspace = workspaces.find((ws) => ws.contains(uri));
  if (!workspace) {
    // workspaces.push(Workspace.createTestWorkspaceFromUri(uri)!);
  } else {
    workspace.add(uri);
  }
  return new LspDocument(doc);
}
