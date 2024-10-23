import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../src/document';

function createFakeUriPath(fname: string) {
  return `file:///home/user/.config/fish/${fname}`;
}

export function createFakeDocument(name: string, text: string) {
  const uri = createFakeUriPath(name);
  const doc = TextDocumentItem.create(uri, 'fish', 1, text);
  return new LspDocument(doc);
}

const jestConsole = console;

/**
 * Sets the console for jest testing
 * ---
 * USAGE:
 * ```typescript
 * describe('Logger', () => {
 *   setLogger();
 *   it('log something', () => {
 *     console.log('hello world');
 *   })
 * });
 * ```
 * ---
 *
 * @param beforeCallback - A callback function to run before each test
 * @param afterCallback - A callback function to run after each test
 * @returns void
 */
export function setLogger(
  beforeCallback: () => Promise<void> = async () => { },
  afterCallback: () => Promise<void> = async () => { },
) {
  beforeEach(async () => {
    // Store the original console
    global.console = require('console');
    await beforeCallback();
  });

  afterEach(async () => {
    // Restore the original console
    global.console = jestConsole;
    await afterCallback();
  });
}
