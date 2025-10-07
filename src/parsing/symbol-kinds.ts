import { SymbolKind, Range } from 'vscode-languageserver';
import { FishSymbol } from './symbol';
import { Option } from './options';

/**
 * ALL possible `FishSymbol.fishKind` values
 */
export type FishSymbolKind = 'ARGPARSE' | 'FUNCTION' | 'ALIAS' | 'COMPLETE' | 'SET' | 'READ' | 'FOR' | 'VARIABLE' | 'FUNCTION_VARIABLE' | 'EXPORT' | 'EVENT' | 'FUNCTION_EVENT' | 'INLINE_VARIABLE';

/**
 * Map/Record of all possible FishSymbolKind values, with lowercase keys to uppercase values.
 * Uppercase values are used for the `FishSymbol.fishKind` property.
 * Lowercase keys are used for displaying the fishKind in the UI.
 */
export const FishSymbolKindMap: Record<Lowercase<FishSymbolKind>, FishSymbolKind> = {
  ['argparse']: 'ARGPARSE',
  ['function']: 'FUNCTION',
  ['alias']: 'ALIAS',
  ['complete']: 'COMPLETE',
  ['set']: 'SET',
  ['read']: 'READ',
  ['for']: 'FOR',
  ['variable']: 'VARIABLE',
  ['event']: 'EVENT',
  ['function_variable']: 'FUNCTION_VARIABLE',
  ['function_event']: 'FUNCTION_EVENT',
  ['export']: 'EXPORT',
  ['inline_variable']: 'INLINE_VARIABLE',
};

/**
 * Maps FishSymbolKind to SymbolKind for use in the LSP.
 * Each FishSymbol.fishKind is mapped to its corresponding SymbolKind.
 */
export const fishSymbolKindToSymbolKind: Record<FishSymbolKind, SymbolKind> = {
  ['ARGPARSE']: SymbolKind.Variable,
  ['FUNCTION']: SymbolKind.Function,
  ['ALIAS']: SymbolKind.Function,
  ['COMPLETE']: SymbolKind.Interface,
  ['SET']: SymbolKind.Variable,
  ['READ']: SymbolKind.Variable,
  ['FOR']: SymbolKind.Variable,
  ['VARIABLE']: SymbolKind.Variable,
  ['FUNCTION_VARIABLE']: SymbolKind.Variable,
  ['EVENT']: SymbolKind.Event,
  ['FUNCTION_EVENT']: SymbolKind.Event,
  ['EXPORT']: SymbolKind.Variable,
  ['INLINE_VARIABLE']: SymbolKind.Variable,
} as const;

/**
 * Creates an object that returns the string representation of each SymbolKind.
 */
export const createSymbolKindLookup = (): Record<SymbolKind, string> => {
  const lookup = {} as Record<SymbolKind, string>;
  for (const [key, value] of Object.entries(SymbolKind)) {
    if (typeof value === 'number') {
      lookup[value] = key;
    }
  }
  return lookup;
};

const symbolKindToStringMap = createSymbolKindLookup();
/**
 * Function to get the string representation of a SymbolKind, from its numeric value.
 */
export const getSymbolKindToString = (kind: SymbolKind): string => {
  return symbolKindToStringMap[kind] || 'Unknown';
};

export namespace FishSymbolKind {

  /**
   * Checks if the given kind is a valid FishSymbolKind.
   */
  export const is = (kind: unknown): kind is FishSymbolKind => {
    if (typeof kind !== 'string') return false;
    return Object.keys(FishSymbolKindMap).includes(kind.toLowerCase());
  };

  /**
   * Converts a FishSymbolKind to its corresponding SymbolKind string.
   */
  export const toSymbolKindStr = (kind: FishSymbolKind): string => {
    return fishSymbolKindToSymbolKind[kind]?.toString();
  };
}

export const fromFishSymbolKindToSymbolKind = (kind: FishSymbolKind) => fishSymbolKindToSymbolKind[kind];

/**
 * Converts either a FishSymbol.fishKind or a SymbolKind to its string representation.
 */
export const symbolKindToString = (kind: SymbolKind | FishSymbolKind): string => {
  if (FishSymbolKind.is(kind)) {
    return FishSymbolKind.toSymbolKindStr(kind);
  }
  return getSymbolKindToString(kind);
};

/***
  * Used to simplify checking FishSymbol.is<KIND>()
  */
type kindGroups = 'VARIABLES' | 'FUNCTIONS' | 'EVENTS' | 'ARGPARSE' | 'OTHER';
export const FishKindGroups: Record<kindGroups, FishSymbolKind[]> = {
  VARIABLES: ['ARGPARSE', 'SET', 'READ', 'FOR', 'VARIABLE', 'FUNCTION_VARIABLE', 'EXPORT'],
  FUNCTIONS: ['FUNCTION', 'ALIAS'],
  EVENTS: ['EVENT', 'FUNCTION_EVENT'],
  ARGPARSE: ['ARGPARSE'],
  OTHER: ['COMPLETE'],
} as const;

/**
 * FishSymbolInput is a type that represents the input required to create a FishSymbol.
 * These are the minimum required fields to build all of the FishSymbol properties.
 */
export type FishSymbolInput = Pick<FishSymbol,
  | 'node'
  | 'focusedNode'
  | 'document'
  | 'fishKind'
  | 'scope'
  | 'detail'
  | 'children'
> & {
  name?: string;
  uri?: string;
  range?: Range;
  selectionRange?: Range;
  options?: Option[];
};

