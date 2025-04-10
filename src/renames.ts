import { getReferences } from './references';
import { Analyzer } from './analyze';
import { Position, Range } from 'vscode-languageserver';
import { LspDocument } from './document';

export type FishRenameLocationType = 'variable' | 'function' | 'command' | 'argparse' | 'flag';

export interface FishRenameLocation {
  uri: string;
  range: Range;
  type: FishRenameLocationType;
  newText: string;
}

export function getRenames(
  analyzer: Analyzer,
  doc: LspDocument,
  position: Position,
  newText?: string,
): FishRenameLocation[] {
  const symbol = analyzer.getDefinition(doc, position);

  if (!symbol) return [];
  const locs = getReferences(analyzer, doc, symbol.selectionRange.start);
  return locs.map(loc => {
    const locationText = analyzer.getTextAtLocation(loc);
    let replaceText = newText || locationText;
    if (locationText.startsWith('_flag_')) {
      loc.range.start.character += '_flag_'.length;
      if (newText?.includes('-')) {
        replaceText = newText.replace(/-/g, '_');
      }
    }
    if (locationText.includes('=')) {
      loc.range.end.character = loc.range.start.character + locationText.indexOf('=');
    }
    return {
      uri: loc.uri,
      range: loc.range,
      type: symbol.fishKind as FishRenameLocationType,
      newText: replaceText,
    };
  });
}

