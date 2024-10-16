import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeParser } from '../src/parser';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { FishDocumentSymbol } from '../src/utils/symbol';
import { getRange } from '../src/utils/tree-sitter';
// import { symbolKindToString } from '../src/utils/translation';

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
  return `file://${homedir()}/.config/fish/${path}`;
}

export function containsCursor(code: string): boolean {
  return code.includes('█');
}

export function removeCursorFromCode(code: string): {
  cursorPosition: LSP.Position;
  input: string;
} {
  let lineNumber = 0;
  let columnNumber = 0;
  let notSet = true;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const currLine = lines.at(i)!;
    if (currLine.includes('█')) {
      notSet = false;
      lineNumber = i;
      columnNumber = currLine.trimStart().indexOf('█') - 1;
      lines[i] = lines[i]!.replace('█', ' ');
    }
    if (notSet) {
      lineNumber++;
      columnNumber++;
    }
  }
  const cursorPosition: LSP.Position = LSP.Position.create(lineNumber, columnNumber);
  return {
    cursorPosition,
    input: lines.join('\n'),
  };
}

export function createFakeCursorLspDocument(name: string, text: string): { doc: LspDocument; cursorPosition: LSP.Position; input: string; } {
  const { cursorPosition, input } = removeCursorFromCode(text);
  const uri = createFakeUriPath(name);
  const doc = TextDocumentItem.create(uri, 'fish', 0, input);
  return { doc: new LspDocument(doc), cursorPosition, input };
}

export function createFakeLspDocument(name: string, text: string): LspDocument {
  const uri = createFakeUriPath(name);
  const doc = TextDocumentItem.create(uri, 'fish', 0, text);
  return new LspDocument(doc);
}

/**
 * @param {FishDocumentSymbol} symbols - nested array of FishDocumentSymbol for a document
 */
export function logFishDocumentSymbolTree(symbols: FishDocumentSymbol[], indentString: string = ''): string {
  let str = '';
  for (const symbol of symbols) {
    str += symbol.scope.tag.padEnd(10) + '::::' + indentString + symbol.toString() + '\n';
    if (symbol.children) {
      str += logFishDocumentSymbolTree(symbol.children, indentString + '    ');
    }
  }
  return str.trim();
}

/**
 * build a string of text before the cursor, this is useful for debugging
 */
export function getCursorText(cursorNode: SyntaxNode, cursorPosition: LSP.Position): string {
  function buildCurrent() {
    let current: SyntaxNode | null = cursorNode;
    const result: string = '';
    while (current) {
      if (current.parent && getRange(current.parent).start.line !== cursorPosition.line) {
        const range = getRange(current).start;
        if (range.line === cursorPosition.line) {
          return String.raw`${current.text.slice(0, cursorPosition.character)}`;
        }
      }
      current = current.parent;
    }
    return result;
  }
  return '`' + buildCurrent() + '█`';
}
