import Parser from 'web-tree-sitter';
import treeSitterWasmPath from 'web-tree-sitter/tree-sitter.wasm';
import fishLanguageWasm from '@esdmr/tree-sitter-fish/tree-sitter-fish.wasm';
import { logger } from './logger';

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
  const fishWasmBuffer = bufferToUint8Array(fishLanguageWasm); // \0asm

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
