import Parser from 'web-tree-sitter';
import treeSitterWasmPath from 'web-tree-sitter/tree-sitter.wasm';
import fishLanguage from '@ndonfris/tree-sitter-fish';

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
  let treeSitterWasmBuffer: Uint8Array;
  if (typeof treeSitterWasmPath === 'string' && treeSitterWasmPath.startsWith('data:application/wasm;base64,')) {
    const base64Data = treeSitterWasmPath.replace('data:application/wasm;base64,', '');
    treeSitterWasmBuffer = Buffer.from(base64Data, 'base64');
  } else if (typeof treeSitterWasmPath === 'string') {
    treeSitterWasmBuffer = Buffer.from(treeSitterWasmPath, 'base64');
  } else {
    treeSitterWasmBuffer = treeSitterWasmPath as Uint8Array;
  }

  // Initialize Parser with embedded WASM binary
  await Parser.init({
    wasmBinary: treeSitterWasmBuffer,
  });

  const parser = new Parser();

  // Load fish language grammar using bundled WASM content
  // Debug: Check what fishWasm actually is

  try {
    const lang = await Parser.Language.load(fishLanguage);
    parser.setLanguage(lang);
  } catch (error) {
    console.error('Error loading fish language grammar:', error);
    console.error('fishWasm type:', typeof fishLanguage);
    console.error('fishWasm instanceof Uint8Array:', fishLanguage instanceof Uint8Array);
    console.error('fishWasm instanceof Buffer:', Buffer.isBuffer(fishLanguage));
    console.error('fishWasm length:', (fishLanguage as any).length);
    console.error('fishWasm first 4 bytes:', Array.from((fishLanguage as any).slice(0, 4)));
    console.error('Expected WASM magic: [0, 97, 115, 109]'); // \0asm
    throw error;
  }

  return parser;
}
