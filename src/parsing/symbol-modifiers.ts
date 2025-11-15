import { SetOptions } from './set';
import { ReadOptions } from './read';
import { ArgparseOptions } from './argparse';
import { CompleteOptions } from './complete';
import { FunctionOptions, FunctionVariableOptions } from './function';
import { FishSymbolKind } from './symbol-kinds';
import { Option } from './options';
import { SemanticTokenModifier, SemanticTokenType } from '../utils/semantics';
import { FishSymbol } from './symbol';

export const SymbolModifiers: Record<FishSymbolKind, Option[]> = {
  SET: SetOptions,
  READ: ReadOptions,
  FOR: [],
  ARGPARSE: ArgparseOptions,
  VARIABLE: [],
  FUNCTION_VARIABLE: [...FunctionVariableOptions],
  FUNCTION: FunctionOptions,
  ALIAS: [Option.create('-g', '--global'), Option.create('-f', '--function')],
  COMPLETE: CompleteOptions,
  EVENT: [],
  FUNCTION_EVENT: [],
  EXPORT: [Option.create('-g', '--global'), Option.create('-x', '--export')],
  INLINE_VARIABLE: [Option.create('-x', '--export')],
};

function getSetReadModifiers(symbol: FishSymbol): SemanticTokenModifier[] {
  const options: Option[] = symbol.options || [];
  const result = new Set<SemanticTokenModifier>();
  result.add(symbol.scopeTag as SemanticTokenModifier);
  for (const opt of options) {
    if (opt.isOption('-g', '--global')) {
      result.add('global');
    }
    if (opt.isOption('-l', '--local')) {
      result.add('local');
    }
    if (opt.isOption('-x', '--export')) {
      result.add('export');
    }
    if (opt.isOption('-U', '--universal')) {
      result.add('universal');
    }
    if (opt.isOption('-f', '--function')) {
      result.add('function');
    }
  }
  if (!result.has(symbol.scopeTag)) {
    result.add(symbol.scopeTag as SemanticTokenModifier);
  }
  if (result.size === 0) {
    result.add('local');
  }
  return Array.from([...result]);
}

export const scopeTagToModifierMap: Record<string, SemanticTokenModifier> = {
  'global': 'global',
  'local': 'local',
  'universal': 'universal',
  'function': 'function',
  'inherit': 'inherit',
};

export function getSymbolModifiers(symbol: FishSymbol): SemanticTokenModifier[] {
  // const mods: FishSemanticTokenModifier[] = ['definition'];
  const mods: SemanticTokenModifier[] = [];
  switch (symbol.fishKind) {
    case 'SET':
    case 'READ':
      return [...mods, ...getSetReadModifiers(symbol)];
    case 'FUNCTION':
      if (
        symbol.isGlobal()
        && symbol.document.isAutoloaded()
        && symbol.name === symbol.document.getAutoLoadName()
      ) {
        mods.push('global', /*'autoloaded'*/);
      } else if (symbol.isLocal() && symbol.document.isAutoloadedUri()) {
        mods.push('local', /*'not-autoloaded'*/);
      } else if (symbol.isLocal()) {
        mods.push('local');
      }
      return mods;
    case 'FUNCTION_VARIABLE':
      if (scopeTagToModifierMap[symbol.scope.scopeTag]) {
        return [...mods, scopeTagToModifierMap[symbol.scope.scopeTag]!];
      }
      return mods;
    case 'ARGPARSE':
      return [...mods, 'local'];
    case 'ALIAS':
      if (symbol.document.isAutoloaded() && symbol.scope.scopeTag === 'global') mods.push('global');
      mods.push(/*'script'*/);
      return mods;
    case 'EXPORT':
      return [...mods, 'global', 'export'];
    case 'FOR':
      return [...mods, 'local'];
    case 'VARIABLE':
      if (scopeTagToModifierMap[symbol.scope.scopeTag]) {
        mods.push(scopeTagToModifierMap[symbol.scope.scopeTag]!);
        return mods;
      }
      return [];
    case 'EVENT':
    case 'FUNCTION_EVENT':
      if (symbol.scope.scopeTag) {
        mods.push(scopeTagToModifierMap[symbol.scope.scopeTag] ?? 'local'), mods;
        return mods;
      }
      return [];
    case 'COMPLETE':
      if (symbol.scope.scopeTag) {
        mods.push(scopeTagToModifierMap[symbol.scope.scopeTag] ?? 'local');
        return mods;
      }
      return mods;
    default:
      return [];
  }
}

export const FishSymbolToSemanticToken: Record<FishSymbolKind, SemanticTokenType> = {
  SET: 'variable',
  READ: 'variable',
  FOR: 'variable',
  ARGPARSE: 'variable',
  VARIABLE: 'variable',
  FUNCTION_VARIABLE: 'variable',
  FUNCTION: 'function',
  ALIAS: 'function',
  COMPLETE: 'function',
  EVENT: 'event',
  FUNCTION_EVENT: 'event',
  EXPORT: 'variable',
  INLINE_VARIABLE: 'variable',
};
