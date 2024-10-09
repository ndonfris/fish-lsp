import { resolve } from 'path';
import Parser from 'web-tree-sitter';

const _global: any = global;

export async function initializeParser(): Promise<Parser> {
  if (_global.fetch) {
    delete _global.fetch;
  }

  await Parser.init();
  const parser = new Parser();

  const fishLangPath = getLanguageWasmPath();
  const lang = await Parser.Language.load(fishLangPath);

  parser.setLanguage(lang);
  return parser;
}

export function getLanguageWasmPath(): string {
  const fishLangPath = resolve(
    __dirname,
    '..',
    'tree-sitter-fish.wasm',
  );
  return fishLangPath.toString();
}

// import tsWasm from 'web-tree-sitter/tree-sitter.wasm?url';
// import tsLang from 'web-tree-sitter/tree-sitter-fish.wasm?url';
// async function loadWasm() {
//   await WebAssembly.compileStreaming(fetch(tsWasm));
//   await WebAssembly.compileStreaming(fetch(tsLang));
// }
