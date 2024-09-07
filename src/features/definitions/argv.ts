import { uriToPath } from '../../utils/translation';
import { DefinitionScope } from '../../utils/definition-scope';
import { isProgram } from '../../utils/node-types';
import { FishDocumentSymbol } from '../../utils/symbol';
import { getRange } from '../../utils/tree-sitter';
import { DocumentUri, SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';

const checkIsAutoLoaded = (uri: string): boolean => {
  const path = uriToPath(uri);
  const splitPath: string[] = path?.split('/');
  const filename = splitPath.at(-1) || '';
  const dirname = splitPath.at(-2) || '';
  return (
    ['functions', 'completions', 'conf.d'].includes(dirname)
    && filename.endsWith('.fish')
  ) || (dirname === 'fish' && filename === 'config.fish');
};

export function isScriptNeededArgv(documentUri: string, node: SyntaxNode): node is SyntaxNode {
  return !checkIsAutoLoaded(documentUri) && isProgram(node)
}


export function createArgvScriptDefinition(uri: DocumentUri, node: SyntaxNode): FishDocumentSymbol[] {
  if (isScriptNeededArgv(uri, node)) {
    return [ FishDocumentSymbol.create({
      name: 'argv',
      kind: SymbolKind.Variable,
      uri,
      range: getRange(node),
      selectionRange: { start: {line: 0, character: 0}, end: {line: 0, character: 0} },
      scope: DefinitionScope.create(
        node,
        'local'
      ),
      node,
      parent: node,
      children: []
    }) ];
  }
  return [];
}

