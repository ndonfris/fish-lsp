// Import polyfills for browser/Node.js compatibility
import './utils/polyfills';
import { createConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver/browser';

// TODO:
// Web-compatible version of fish-lsp
// This is a simplified version that aims to get base version working in browser environments

export class FishLspWeb {
  private connection: ReturnType<typeof createConnection>;

  constructor() {
    // Create browser-compatible connection
    this.connection = createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self));
    this.setupHandlers();
  }

  private setupHandlers() {
    this.connection.onInitialize((params) => {
      this.connection.console.log(`Fish LSP Web initializing...\n{ ${params}}`);

      return {
        capabilities: {
          textDocumentSync: 1, // Full sync
          completionProvider: {
            resolveProvider: true,
            triggerCharacters: ['$', '-', ' '],
          },
          hoverProvider: true,
          documentSymbolProvider: true,
          // Add more capabilities as needed for web version
        },
        serverInfo: {
          name: 'fish-lsp-web',
          version: '1.0.0',
        },
      };
    });

    this.connection.onCompletion(() => {
      // Basic completion implementation for web
      return {
        isIncomplete: false,
        items: [
          {
            label: 'echo',
            kind: 3, // Function
            detail: 'Print arguments to stdout',
          },
          {
            label: 'set',
            kind: 3,
            detail: 'Set or get environment variables',
          },
        ],
      };
    });

    this.connection.onHover(() => {
      return {
        contents: 'Fish LSP Web - Limited functionality in browser',
      };
    });

    // Handle browser-specific cleanup
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.connection.dispose();
      });
    }
  }

  public listen() {
    this.connection.listen();
  }

  public dispose() {
    this.connection.dispose();
  }
}

// NOTE: This module intentionally does NOT auto-start `FishLspWeb` as a
// top-level side effect. `main.ts` imports this file unconditionally so it
// gets bundled into the CLI binary, and a runtime `new FishLspWeb().listen()`
// call at import time would open an LSP connection over `self` (e.g. stdio
// via a worker) as soon as the module loads — which is exactly what caused
// the CLI to hang under Bun (`self` is defined there too, see #173). Explicit
// browser entry points must construct `FishLspWeb` and call `.listen()`
// themselves.

export default FishLspWeb;
