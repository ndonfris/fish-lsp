import Parser from 'tree-sitter';
import fish from 'tree-sitter-fish';

export async function initializeParser(): Promise<Parser> {
  const parser = new Parser();
  parser.setLanguage(fish);
  return parser;
}
