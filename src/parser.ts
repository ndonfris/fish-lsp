import Parser from 'web-tree-sitter';
import treeSitterWasmPath from 'web-tree-sitter/tree-sitter.wasm';
import fishLanguageWasm from '@esdmr/tree-sitter-fish/tree-sitter-fish.wasm';
import { readFileSync } from 'fs';
import { logger } from './logger';
import { config } from './config';
import { SyncFileHelper } from './utils/file-operations';

const _global: any = global;

export async function initializeParser(): Promise<Parser> {
  if (_global.fetch) {
    delete _global.fetch;
  }
  if (!_global.Module) {
    _global.Module = {
      onRuntimeInitialized: () => { },
      instantiateWasm: undefined,
      locateFile: undefined,
      wasmBinary: undefined,
    };
  }

  // treeSitterWasmPath is already a Uint8Array from the esbuild plugin
  // which reads web-tree-sitter/tree-sitter.wasm and embeds it
  const tsWasmBuffer = bufferToUint8Array(treeSitterWasmPath);

  // Initialize Parser with embedded WASM binary
  await Parser.init({
    wasmBinary: tsWasmBuffer,
  });

  const parser = new Parser();
  const fishWasmBuffer = getFishLanguageWasmBuffer(); // \0asm

  try {
    const lang = await Parser.Language.load(fishWasmBuffer);
    parser.setLanguage(lang);
  } catch (error) {
    logger.logToStderr('Failed to load fish language grammar for tree-sitter parser.');
    console.error('Error loading fish language grammar:', error);
    throw error;
  }

  return parser;
}

// resolve the WASM buffer for the fish language grammar, allowing for an optional override via environment variable or config setting
function getFishLanguageWasmBuffer(): Uint8Array {
  const overridePath = process.env.fish_lsp_tree_sitter_wasm_path || config.fish_lsp_tree_sitter_wasm_path;
  if (!overridePath) {
    return bufferToUint8Array(fishLanguageWasm);
  }

  const expandedOverridePath = SyncFileHelper.expandNormalize(overridePath);

  if (!SyncFileHelper.exists(expandedOverridePath)) {
    logger.warning(`fish_lsp_tree_sitter_wasm_path override specified but file does not exist: ${overridePath}`);
    return bufferToUint8Array(fishLanguageWasm);
  }
  try {
    // Keep this runtime-only so browser bundles can still compile without a
    // hard dependency on Node's fs module.
    logger.log(`Loading tree-sitter-fish wasm override from: ${expandedOverridePath}`);
    return readFileSync(expandedOverridePath);
  } catch (error) {
    logger.logToStderr(`Failed to load fish_lsp_tree_sitter_fish_wasm override: ${overridePath}`);
    console.error(error);
    throw error;
  }
}

function bufferToUint8Array(buffer: ArrayBuffer | Buffer | string): Uint8Array {
  if (typeof buffer === 'string' && buffer.startsWith('data:application/wasm;base64,')) {
    const base64Data = buffer.replace('data:application/wasm;base64,', '');
    return Buffer.from(base64Data, 'base64');
  } else if (typeof buffer === 'string') {
    return Buffer.from(buffer, 'base64');
  } else {
    return buffer as Uint8Array;
  }
}
