import Parser from 'web-tree-sitter';
import { getTreeSitterWasmPath } from './utils/path-resolution';

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
  return getTreeSitterWasmPath();
}
