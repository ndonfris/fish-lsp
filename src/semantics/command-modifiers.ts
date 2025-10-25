import { SyntaxNode } from 'web-tree-sitter';
import { isBuiltin } from '../utils/builtins';
import { calculateModifiersMask } from '../utils/semantics';
import { analyzer } from '../analyze';
import { cachedCompletionMap } from '../server';
import { PrebuiltDocumentationMap } from '../utils/snippets';


/**
 * Get semantic token modifiers for a command based on its definition
 * @param commandName - The name of the command
 * @returns Bitmask of token modifiers
 */
export function getCommandModifiers(commandNode: SyntaxNode): number {
  const commandName = commandNode.firstNamedChild?.text;

  if (!commandName) {
    return 0;
  }

  // Check if it's a builtin command
  if (isBuiltin(commandName)) {
    // Note: We can't check isBuiltinCommand without a node, so builtins are handled separately
    return calculateModifiersMask('builtin');
  }

  const allCommands = PrebuiltDocumentationMap.getByType('command');
  if (allCommands.some(s => commandName === s.name)) {
    return calculateModifiersMask('global');
  }

  // Look up the command in global symbols
  const symbols = analyzer.globalSymbols.find(commandName);
  const firstGlobal = cachedCompletionMap.get('function').find(c => c.label === commandName);

  if (symbols.length === 0) {
    // No definition found - could be an external command or not found

    if (firstGlobal) {
      return calculateModifiersMask('global');
    }

    return 0;
  }

  // Use the first symbol found (most relevant)
  const symbol = symbols[0]!;

  // Check if it's a function
  if (symbol.fishKind === 'FUNCTION') {
    const modifiers: string[] = [];

    // Check if it's autoloaded
    if (symbol.isGlobal() && symbol.document.isAutoloaded() &&
      symbol.name === symbol.document.getAutoLoadName()) {
      modifiers.push('global', 'autoloaded');
    } else if (symbol.isGlobal()) {
      // Global but not autoloaded
      modifiers.push('global', 'script');
    } else if (symbol.isLocal()) {
      modifiers.push('local');
    }

    return calculateModifiersMask(...modifiers);
  }

  // Check if it's an alias
  if (symbol.fishKind === 'ALIAS') {
    const modifiers: string[] = [];
    if (symbol.document.isAutoloaded() && symbol.scope.scopeTag === 'global') {
      modifiers.push('global');
    }
    modifiers.push('script');
    return calculateModifiersMask(...modifiers);
  }

  return 0;
}
 
