import Parser from 'web-tree-sitter';
import treeSitterWasmPath from 'web-tree-sitter/tree-sitter.wasm';
import fishLanguageWasm from '@esdmr/tree-sitter-fish/tree-sitter-fish.wasm';

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
  // fishLanguageWasm is already a Uint8Array from the esbuild plugin
  // which reads @esdmr/tree-sitter-fish/tree-sitter-fish.wasm and embeds it
  let fishWasmBuffer: Uint8Array;
  if (typeof fishLanguageWasm === 'string' && fishLanguageWasm.startsWith('data:application/wasm;base64,')) {
    const base64Data = fishLanguageWasm.replace('data:application/wasm;base64,', '');
    fishWasmBuffer = Buffer.from(base64Data, 'base64');
  } else if (typeof fishLanguageWasm === 'string') {
    fishWasmBuffer = Buffer.from(fishLanguageWasm, 'base64');
  } else {
    fishWasmBuffer = fishLanguageWasm as Uint8Array;
  }

  try {
    const lang = await Parser.Language.load(fishWasmBuffer);
    parser.setLanguage(lang);
  } catch (error) {
    console.error('Error loading fish language grammar:', error);
    console.error('fishWasm type:', typeof fishLanguageWasm);
    console.error('fishWasm instanceof Uint8Array:', (fishLanguageWasm as any) instanceof Uint8Array);
    console.error('fishWasm instanceof Buffer:', Buffer.isBuffer(fishLanguageWasm as any));
    console.error('fishWasm length:', (fishLanguageWasm as any).length);
    console.error('fishWasm first 4 bytes:', Array.from((fishWasmBuffer as any).slice(0, 4)));
    console.error('Expected WASM magic: [0, 97, 115, 109]'); // \0asm
    throw error;
  }

  return parser;
}
