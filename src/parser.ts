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

  //  = resolve(
  //     //'..',
  //     __dirname,
  //     '..',
  //     'tree-sitter-fish.wasm'
  // ).toString()
  // console.log(fishLangPath);

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
