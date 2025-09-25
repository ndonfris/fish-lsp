// Import polyfills for browser/Node.js compatibility
import './utils/array-polyfills';
import { createConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver/browser';

// Web-compatible version of fish-lsp
// This is a simplified version that works in browser environments

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

// Auto-start for web environments
if (typeof window !== 'undefined' || typeof self !== 'undefined') {
  const fishLsp = new FishLspWeb();
  fishLsp.listen();
}

export default FishLspWeb;
