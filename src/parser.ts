import Parser from 'web-tree-sitter';
import { getTreeSitterWasmPath } from './utils/path-resolution';
import wasmContent from '@embedded_assets/tree-sitter.wasm';
import fishWasmContent from '@embedded_assets/tree-sitter-fish.wasm';
// import vfs from './virtual-fs';

const _global: any = global;

export async function initializeParser(): Promise<Parser> {
  // Set up Node.js environment for web-tree-sitter
  if (_global.fetch) {
    delete _global.fetch;
  }

  // Provide missing WebAssembly environment functions
  if (typeof _global.WebAssembly === 'undefined') {
    _global.WebAssembly = (globalThis as any).WebAssembly;
  }

  // Polyfill for WebAssembly environment functions
  if (!_global.Module) {
    _global.Module = {
      onRuntimeInitialized: () => {},
      instantiateWasm: undefined,
      locateFile: undefined,
      wasmBinary: undefined,
    };
  }
  //
  //
  //
  // await Parser.init({
  //   // getTreeSitterWasmPath()
  //   // locateFile(scriptName: string, scriptDirectory: string): string {
  //   // require('node_modules/web-tree-sitter/tree-sitter.wasm');
  //   // loacteFile: (scriptName: string, '.') => getCoreTreeSitterWasmPath(),
  //   // wasmContent
  // });
  // Convert wasmContent from data URL to Buffer
  let wasmBuffer: Uint8Array;
  if (typeof wasmContent === 'string' && wasmContent.startsWith('data:application/wasm;base64,')) {
    const base64Data = wasmContent.replace('data:application/wasm;base64,', '');
    wasmBuffer = Buffer.from(base64Data, 'base64');
  } else if (typeof wasmContent === 'string') {
    wasmBuffer = Buffer.from(wasmContent, 'base64');
  } else {
    wasmBuffer = wasmContent;
  }

  await Parser.init({
    wasmBinary: wasmBuffer,
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

  // Use embedded WASM content or fallback to filesystem
  const lang = fishWasmBuffer && fishWasmBuffer.length > 0
    ? await Parser.Language.load(fishWasmBuffer)
    : await Parser.Language.load(getLanguageWasmPath());

  parser.setLanguage(lang);
  return parser;
}

export function getLanguageWasmPath(): string {
  return getTreeSitterWasmPath();
}
