import { getTokenTypeIndex, calculateModifiersMask } from '../utils/semantics';

export type TokenTypeKey = 'command' | 'function' | 'variable' | 'keyword' | 'decorator' | 'string' | 'operator';
export const TokenTypes: Record<TokenTypeKey, number> = {
  command: getTokenTypeIndex('function')!,
  function: getTokenTypeIndex('function')!,
  variable: getTokenTypeIndex('variable')!,
  keyword: getTokenTypeIndex('keyword')!,
  decorator: getTokenTypeIndex('decorator')!,
  string: getTokenTypeIndex('string')!,
  operator: getTokenTypeIndex('operator')!,
};

export const ModifierTypes: Record<TokenTypeKey, number> = {
  command: calculateModifiersMask('builtin')!,
  function: 0,
  variable: 0,
  keyword: 0,
  decorator: calculateModifiersMask('shebang'),
  string: 0,
  operator: 0,
};
