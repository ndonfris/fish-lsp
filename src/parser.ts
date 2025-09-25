import Parser from 'web-tree-sitter';
import treeSitterWasmContent from '@embedded_assets/tree-sitter.wasm';
import fishWasmContent from '@embedded_assets/tree-sitter-fish.wasm';

const _global: any = global;

export async function initializeParser(): Promise<Parser> {
  if (_global.fetch) {
    delete _global.fetch;
  }
  if (!_global.Module) {
    _global.Module = {
      onRuntimeInitialized: () => {},
      instantiateWasm: undefined,
      locateFile: undefined,
      wasmBinary: undefined,
    };
  }

  // Convert tree-sitter WASM content from data URL to Buffer
  let treeSitterWasmBuffer: Uint8Array;
  if (typeof treeSitterWasmContent === 'string' && treeSitterWasmContent.startsWith('data:application/wasm;base64,')) {
    const base64Data = treeSitterWasmContent.replace('data:application/wasm;base64,', '');
    treeSitterWasmBuffer = Buffer.from(base64Data, 'base64');
  } else if (typeof treeSitterWasmContent === 'string') {
    treeSitterWasmBuffer = Buffer.from(treeSitterWasmContent, 'base64');
  } else {
    treeSitterWasmBuffer = treeSitterWasmContent;
  }

  // Initialize Parser with embedded WASM binary
  await Parser.init({
    wasmBinary: treeSitterWasmBuffer,
  });

  const parser = new Parser();

  // Convert fish WASM content from data URL to Buffer
  let fishWasmBuffer: Uint8Array;
  if (typeof fishWasmContent === 'string' && fishWasmContent.startsWith('data:application/wasm;base64,')) {
    const base64Data = fishWasmContent.replace('data:application/wasm;base64,', '');
    fishWasmBuffer = Buffer.from(base64Data, 'base64');
  } else if (typeof fishWasmContent === 'string') {
    fishWasmBuffer = Buffer.from(fishWasmContent, 'base64');
  } else {
    fishWasmBuffer = fishWasmContent;
  }

  // Load fish language grammar using embedded WASM content
  const lang = await Parser.Language.load(fishWasmBuffer);
  parser.setLanguage(lang);
  return parser;
}

export function getLanguageWasmPath(): string {
  // This function is kept for compatibility, but we now use embedded WASM content
  return '@embedded_assets/tree-sitter-fish.wasm';
}
