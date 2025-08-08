/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */

import Parser from 'web-tree-sitter';
import { getTreeSitterWasmPath } from './utils/path-resolution';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const _global: any = global;

export async function initializeParser(): Promise<Parser> {
  if (_global.fetch) {
    delete _global.fetch;
  }

  // Initialize with embedded web-tree-sitter WASM if available
  const webTreeSitterWasm = process.env.WEB_TREE_SITTER_EMBEDDED_WASM;
  if (webTreeSitterWasm) {
    try {
      // Create temporary file for web-tree-sitter
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-lsp-'));
      const tempWasmPath = path.join(tempDir, 'tree-sitter.wasm');

      const wasmBuffer = Buffer.from(webTreeSitterWasm, 'base64');
      fs.writeFileSync(tempWasmPath, wasmBuffer);

      // Set up locateFile to find our temporary WASM
      await Parser.init({
        locateFile: (file: string) => {
          if (file === 'tree-sitter.wasm') {
            return tempWasmPath;
          }
          return file;
        },
      });

      // Clean up temp file on exit
      process.on('exit', () => {
        try {
          fs.unlinkSync(tempWasmPath);
          fs.rmdirSync(tempDir);
        } catch (e) {
          console.error('Error cleaning up temporary files:', e);
        }
      });
    } catch (error) {
      await Parser.init();
    }
  } else {
    await Parser.init();
  }

  const parser = new Parser();
  const lang = await loadFishLanguage();
  parser.setLanguage(lang);
  return parser;
}

async function loadFishLanguage(): Promise<Parser.Language> {
  // Try embedded WASM first (for bundled binary)
  const embeddedWasm = process.env.FISH_LSP_EMBEDDED_WASM;

  if (embeddedWasm) {
    try {
      const wasmBuffer = Buffer.from(embeddedWasm, 'base64');
      return await Parser.Language.load(wasmBuffer);
    } catch (error) {
      // Fall through to file system loading
    }
  }

  // Fallback to file system loading (for development)
  const fishLangPath = getTreeSitterWasmPath();
  return await Parser.Language.load(fishLangPath);
}

export function getLanguageWasmPath(): string {
  return getTreeSitterWasmPath();
}
