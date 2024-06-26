import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeParser } from '../src/parser';
import Parser, { Point, SyntaxNode, Tree, Logger } from 'web-tree-sitter';
import { Analyzer } from '../src/analyze';
import { getChildNodes, getNodesTextAsSingleLine, getRange, positionToPoint } from '../src/utils/tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolInformation, Location, SymbolKind, Range, DocumentSymbol, TextDocumentItem } from 'vscode-languageserver';
import { symbolKindToString } from '../src/utils/translation';
const colors = require('colors');
//import {bgBlack, bgBlue, black, inverse, white, Color} from 'colors';
import { LspDocument } from '../src/document';
import console from 'console';
import { homedir } from 'os';
import { URI } from 'vscode-uri';

const util = require('util');

export type LoggerOptions = {
    LogTestName?: boolean,
    LogStartEnd?: boolean,
    LogSep?: boolean,
    Space?: boolean,
}

export const LogOpts: Record<'clean' | 'separated' | 'extra', LoggerOptions> = {
  clean: { LogSep: true, Space: true, LogTestName: true },
  separated: { LogSep: true, Space: true },
  extra: { LogSep: true, Space: true, LogStartEnd: true },
};
export const CleanLogging : LoggerOptions = { LogSep: true, Space: true, LogTestName: true };

export function setLogger(
  beforeCallback: () => Promise<void> = async () => {},
  afterCallback: () => Promise<void> = async () => {},
  Opts?: LoggerOptions,
) {
  const jestConsole = console;
  beforeEach(async () => {
    global.console = require('console');
    LogSpecial('before', Opts);
    await beforeCallback();
  }, 10000);
  afterEach(async () => {
    global.console = jestConsole;
    LogSpecial('after', Opts);
    await afterCallback();
  }, 10000);
}

function LogSpecial(current: 'before' | 'after', Opts?: LoggerOptions) {
  const name = expect.getState().currentTestName!.toString().toUpperCase();
  //if (expect.getState().)
  const len = Opts?.LogTestName || Opts?.LogStartEnd ? name.length + 7 : 80;
  const sep = '━'.repeat(len);
  colors.setTheme({
    keyword:  ['bgBlue', 'white', 'bold'],
    testname: ['blue', 'underline', 'bold'],
    line:     ['white', 'bold', 'strikethrough'],
  });
  const testStr = `${colors.keyword('TEST:  ')}${colors.testname(name)}`;
  const startStr = `${colors.keyword('START: ')}${colors.testname(name)}`;
  const endStr = `${colors.keyword('END:   ')}${colors.testname(name)}`;

  const start = [colors.line(sep), startStr, colors.line(sep)].join('\n');
  const end = [colors.line(sep), endStr, colors.line(sep)].join('\n');

  switch (current) {
    case 'before':
      if (Opts?.Space) console.log();
      if (Opts?.LogSep) console.log(colors.line(sep));
      if (Opts?.LogTestName) {
        console.log(testStr);
        if (Opts?.LogSep) console.log(colors.line(sep));
        break;
      }
      if (Opts?.LogStartEnd) console.log(start);
      break;
    case 'after':
      if (Opts?.LogSep) console.log(colors.line(sep));
      if (Opts?.LogStartEnd) console.log(end);
      if (Opts?.LogTestName || Opts?.Space) console.log();
      break;
  }
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

export function resolveRelPath(dirname: string, fname: string): string {
  const file = readFileSync(resolve(dirname, fname), 'utf8');
  return file.toString();
}

export async function resolveAbsPath(fname: string): Promise<string[]> {
  const file = readFileSync(resolve(fname), 'utf8');
  return file.split('\n');
}

export function positionStr(pos: Point) {
  return `{ row: ${pos.row.toString()}, column: ${pos.column.toString()} }`;
}

export async function readFishDir(dir: string): Promise<string[]> {
  let files: string[] = [];
  try {
    files = readdirSync(dir, { encoding:'utf8', withFileTypes: false });
  } catch (e) {
    console.log(e);
  }
  return files.map(file => dir + '/' + file.toString());
}

export async function readShareDir(): Promise<string[]> {
  let files: string[] = [];
  try {
    files = readdirSync('/usr/share/fish/functions/', { encoding:'utf8', withFileTypes: false });
  } catch (e) {
    console.log(e);
  }
  return files.map(file => '/usr/share/fish/functions/' + file.toString());
}

export async function parseFile(fname: string) : Promise<Tree> {
  const text = await resolveAbsPath(fname);
  const parser = await initializeParser();
  const tree = parser.parse(text.join('\n'));
  return tree;
}

export function createFakeUriPath(path: string): string {
  return `file://${homedir()}/.config/fish/${path}`;
}

export function createFakeLspDocument(name: string, text: string): LspDocument {
  const uri = createFakeUriPath(name);
  const doc = TextDocumentItem.create(uri, 'fish', 0, text);
  return new LspDocument(doc);
}

export type truncatedNode = {
    text: string,
    type: string,
    startPosition: string,
    endPosition: string,
    // children: truncatedNode[],
    // siblings: truncatedNode[],
}

export function getTruncatedNode(node: SyntaxNode) {
  return {
    text: node.text,
    type: node.type,
    startPosition: positionStr(node.startPosition),
    endPosition: positionStr(node.endPosition),
    // children: node.children.map(child => getTruncatedNode(child)),
    // siblings: node.parent?.children.map(child => getTruncatedNode(child)) || [],
  };
}

export function logNode(node: Parser.SyntaxNode): void {
  const truncateText = (text: string, length: number): string => {
    return text.length > length ? text.substring(0, length) + '...' : text;
  };

  const cleanNodeInfo = (info: object): object => {
    return Object.fromEntries(
      Object.entries(info).filter(([_, value]) => value != null),
    );
  };

  const logPos = (node: Parser.SyntaxNode) => {
    return {
      startPosition: positionStr(node.startPosition), endPosition: positionStr(node.endPosition), startIndex: node.startIndex, endIndex: node.endIndex,

    };
  };

  const logNodeHelper = (node: Parser.SyntaxNode): void => {
    const nodeInfo = {
      type: node.type,
      text: truncateText(node.text, 20),
      ...logPos(node),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      parent: node.parent ? { type: node.parent.type, text: truncateText(node.parent.text, 20) } : null,
      children: node.children.length ? node.children.map(child => ({ type: child.type, text: truncateText(child.text, 20), ...logPos(child) })) : null,
      firstChild: node.firstChild ? { type: node.firstChild.type, text: truncateText(node.firstChild.text, 20) } : null,
      lastChild: node.lastChild ? { type: node.lastChild.type, text: truncateText(node.lastChild.text, 20) } : null,
      firstNamedChild: node.firstNamedChild ? { type: node.firstNamedChild.type, text: truncateText(node.firstNamedChild.text, 20) } : null,
      lastNamedChild: node.lastNamedChild ? { type: node.lastNamedChild.type, text: truncateText(node.lastNamedChild.text, 20) } : null,
      nextSibling: node.nextSibling ? { type: node.nextSibling.type, text: truncateText(node.nextSibling.text, 20) } : null,
      previousSibling: node.previousSibling ? { type: node.previousSibling.type, text: truncateText(node.previousSibling.text, 20) } : null,
    };

    console.log(JSON.stringify(cleanNodeInfo(nodeInfo), null, 2));

    // for (const child of node.children) {
    //   logNodeHelper(child, depth + 1);
    // }
  };

  logNodeHelper(node);
}

/**
 * Escapes special characters in a given string.
 * @param str - The string to escape.
 * @returns The escaped string.
 */
export function escapeSpecialCharacter(str: string): string {
  const specialCharacters: { [key: string]: string } = {
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\b': '\\b',
    '\f': '\\f',
    '\\': '\\\\',
    '\"': '\\"',
    '\'': '\\\'',
  };

  return str.replace(/[\n\r\t\b\f\\\"\'\u0000-\u001f\u007f-\u009f]/g, (match) => {
    return specialCharacters[match] || `\\u${match.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

