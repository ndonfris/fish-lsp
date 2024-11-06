import { FishSymbol } from '../utils/symbol';
import { PrebuiltDocumentationMap } from '../utils/snippets';
import { MarkdownDetail } from '../utils/detail-builder';
import { md } from '../utils/markdown-builder';
// import { boolOrEmpty, removePrecedingBlockWhitespace } from './symbol-info';
import * as Locations from '../utils/locations';
// import { getPathProperties } from '../utils/translation';
import { SyntaxNode } from 'web-tree-sitter';

export function getPrebuiltSymbolInfo(symbol: FishSymbol) {
  const prebuiltDocumentation = PrebuiltDocumentationMap.getByName(symbol.name).pop();
  if (!prebuiltDocumentation) return '';

  const markdownDocumentation = [
    `${prebuiltDocumentation?.specialType ?? ''} ${prebuiltDocumentation?.type ?? ''}`.trimStart(),
    '',
    prebuiltDocumentation?.description,
  ].join('\n');
  /** add syntax highlighting to symbol, with `$` for variable usage, and `symbol.name` for functions */
  const name = symbol.kindString === 'function' ? symbol.name : `$${symbol.name}`;
  const result = MarkdownDetail.create();
  result.addText(md.codeBlock('fish', name));
  result.addText(md.separator());
  result.addText(markdownDocumentation);
  result.addText(md.separator());
  if (symbol.isFunction()) {
    result.addFromDetail(symbol.functionInfo.toDetail());
  }
  if (symbol.isVariable()) {
    result.addFromDetail(symbol.variableInfo.toDetail());
  }
  // result.addSection('Path', md.italic(getPathProperties(symbol.uri).shortenedPath));
  // result.addSection('Scope', symbol.modifier);
  // result.addSection('Exported', boolOrEmpty(symbol.isGlobalScope()));
  // result.addText(md.separator());
  // result.addText(md.codeBlock('fish', removePrecedingBlockWhitespace(symbol.parentNode)));
  return result.build();
}

export function getPrebuiltSymbol(focused: SyntaxNode, flatSymbols: FishSymbol[]): FishSymbol | null {
  for (const symbol of flatSymbols) {
    if (
      PrebuiltDocumentationMap.getByName(symbol.name) &&
      Locations.Range.containsRange(
        Locations.Range.fromNode(symbol.parentNode),
        Locations.Range.fromNode(focused))
    ) {
      if (symbol.isFunction()) {
        return symbol;
      }
      if (symbol.isVariable() && ['set', 'read'].includes(symbol.getParentKeyword())) {
        return symbol;
      }
    }
  }
  return null;
}

export function hasPrebuiltSymbolInfo(focused: SyntaxNode, flatSymbols: FishSymbol[]) {
  for (const symbol of flatSymbols) {
    if (
      symbol.isVariable() &&
      PrebuiltDocumentationMap.getByName(symbol.name) &&
      Locations.Range.containsRange(
        Locations.Range.fromNode(symbol.parentNode),
        Locations.Range.fromNode(focused))
    ) {
      return ['set', 'read'].includes(symbol.getParentKeyword());
    }
    if (
      symbol.isFunction() &&
      PrebuiltDocumentationMap.getByName(symbol.name)
    ) {
      return true;
    }
  }
  return false;
}