import { CodeLens } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { getReferences } from './references';
import { uriToPath } from './utils/translation';

export function getReferenceCountCodeLenses(analyzer: Analyzer, document: LspDocument): CodeLens[] {
  const codeLenses: CodeLens[] = [];

  // Filter for global symbols
  const globalSymbols = analyzer.getFlatDocumentSymbols(document.uri)
    .filter(symbol => symbol.fishKind === 'FUNCTION');

  // Create a code lens for each global symbol
  for (const symbol of globalSymbols) {
    // Get reference count
    const references = getReferences(document, symbol.selectionRange.start) || [];
    const referencesCount = references.length;
    codeLenses.push({
      range: symbol.range,
      command: {
        title: `${referencesCount} references`,
        command: 'fish-lsp.showReferences',
        arguments: [uriToPath(document.uri), symbol.selectionRange.start, references],
      },
    });
  }

  return codeLenses;
}
