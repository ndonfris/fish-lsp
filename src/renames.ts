import { getReferences } from './references';
import { analyzer, Analyzer } from './analyze';
import { Position, Range } from 'vscode-languageserver';
import { LspDocument } from './document';
import { FishSymbol } from './parsing/symbol';
import { logger } from './logger';

export type FishRenameLocationType = 'variable' | 'function' | 'command' | 'argparse' | 'flag';

export interface FishRenameLocation {
  uri: string;
  range: Range;
  type: FishRenameLocationType;
  newText: string;
}

export function getRenames(
  doc: LspDocument,
  position: Position,
  newText: string,
): FishRenameLocation[] {
  const symbol = analyzer.getDefinition(doc, position);
  if (!symbol || !newText) return [];
  if (!canRenameWithNewText(analyzer, doc, position, newText)) return [];
  newText = fixNewText(symbol, position, newText);
  const locs = getReferences(doc, symbol.selectionRange.start);
  return locs.map(loc => {
    const locationText = analyzer.getTextAtLocation(loc);
    let replaceText = newText || locationText;
    if (locationText.startsWith('_flag_') && symbol.fishKind === 'ARGPARSE') {
      loc.range.start.character += '_flag_'.length;
      if (newText?.includes('-')) {
        replaceText = newText.replace(/-/g, '_');
      }
    }
    if (locationText.includes('=') && symbol.fishKind === 'ARGPARSE') {
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

/**
 * Currently for rename requests that are for an argparse FishSymbol,
 * that are from a request that is not on the symbol definition.
 * ```fish
 * function foo
 *      argparse 'values-with=?' -- $argv
 *      or return
 *
 *      if set -ql _flag_values_with
 *      end
 * end
 *
 * foo --values-with
 * ```
 *
 * Case 1.)  the rename request is on `_flag_values_with`, we need to remove the
 *           leading `_flag_` from the newText
 *
 * Case 2.) the rename request is on `--values-with`, we need to remove the leading `--`
 */
function fixNewText(symbol: FishSymbol, position: Position, newText: string) {
  // EDGE CASE 1: rename on a flag usage: _flag_values_with
  //              would still work if the rename request is under `argparse 'values-with=?'`
  //              So, we need a check for if the newText starts with _flag_, then we trim off the _flag_
  if (symbol.fishKind === 'ARGPARSE' && !symbol.containsPosition(position) && newText?.startsWith('_flag_')) {
    return newText.replace(/^_flag_/g, '').replace(/_/g, '-');
  }
  // EDGE CASE 2: rename on a flag usage: `--values-with`
  //              would still work if the rename request is under `argparse 'values-with=?'`
  //              So, we need to check for leading '-', and remove them
  if (symbol.fishKind === 'ARGPARSE' && !symbol.containsPosition(position) && newText?.startsWith('-')) {
    return newText.replace(/^-{1,2}/, '');
  }
  return newText;
}

function canRenameWithNewText(analyzer: Analyzer, doc: LspDocument, position: Position, newText: string): boolean {
  const isShort = (str: string) => {
    if (str.startsWith('--')) return false;
    if (str.startsWith('-')) return true;
    return false;
  };

  const isLong = (str: string) => {
    if (str.startsWith('--')) return true;
    if (str.startsWith('-')) return false;
    return false;
  };

  const isEqualFlags = (str1: string, str2: string) => {
    if (isShort(str1) && !isShort(str2)) {
      return false;
    }
    if (isLong(str1) && !isLong(str2)) {
      return false;
    }
    return true;
  };

  const isFlag = (str: string) => {
    return str.startsWith('-');
  };

  const oldText = analyzer.wordAtPoint(doc.uri, position.line, position.character);
  logger.log({
    oldText,
    newText,
  });
  if (oldText && isFlag(oldText) && !isEqualFlags(oldText, newText)) return false;
  return true;
}

