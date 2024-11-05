import * as LSP from 'vscode-languageserver';
import { Hover, MarkupKind } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from './future-analyze';
import { LspDocument } from './document';
import { documentationHoverProvider, enrichCommandWithFlags } from './documentation';
import { DocumentationCache } from './utils/documentation-cache';
import { execCommandDocs, execCompletions, execSubCommandCompletions } from './utils/exec';
import { isCommand, isFunctionDefinition, isOption } from './utils/node-types';
import { findFirstParent } from './utils/tree-sitter';
import { symbolKindsFromNode } from './utils/translation';
import { Logger } from './logger';

export async function handleHover(
  analyzer: Analyzer,
  document: LspDocument,
  position: LSP.Position,
  current: Parser.SyntaxNode,
  cache: DocumentationCache,
  logger?: Logger,
): Promise<LSP.Hover | null> {
  if (isOption(current)) {
    return await getHoverForFlag(current);
  }
  const local = analyzer.getDefinitionSymbol(document, position).pop();
  if (local) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: local.detail!,
      },
      range: local.selectionRange,
    };
  }
  const { kindType, kindString } = symbolKindsFromNode(current);
  const symbolType = ['function', 'class', 'variable'].includes(kindString) ? kindType : undefined;
  logger?.log({ './src/hover.ts:37': kindType });

  if (cache.find(current.text) !== undefined) {
    await cache.resolve(current.text, document.uri, symbolType);
    const item = symbolType ? cache.find(current.text, symbolType) : cache.getItem(current.text);
    logger?.logAsJson('call: [./src/hover.ts:42]');

    if (item && item?.docs) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: item.docs.toString(),
        },
      };
    }
  }
  const commandString = await collectCommandString(current);

  const result = await documentationHoverProvider(commandString);
  logger?.log({ commandString, result });
  return result;
}

export async function getHoverForFlag(current: Parser.SyntaxNode): Promise<Hover | null> {
  const commandNode = findFirstParent(current, n => isCommand(n) || isFunctionDefinition(n));
  if (!commandNode) {
    return null;
  }
  let commandStr = [commandNode.child(0)?.text || ''];
  const flags: string[] = [];
  let hasFlags = false;
  for (const child of commandNode?.children || []) {
    if (!hasFlags && !child.text.startsWith('-')) {
      commandStr = await appendToCommand(commandStr, child.text);
    } else if (child.text.startsWith('-')) {
      flags.push(child.text);
      hasFlags = true;
    }
  }
  const flagCompletions = await execCompletions(...commandStr, '-');
  const shouldSplitShortFlags = hasOldUnixStyleFlags(flagCompletions);
  const fixedFlags = spiltShortFlags(flags, !shouldSplitShortFlags);
  const found = flagCompletions
    .map(line => line.split('\t'))
    .filter(line => fixedFlags.includes(line[0] as string))
    .map(line => line.join('\t'));

  return {
    contents: enrichCommandWithFlags(commandStr.join('-'), found),
  };
}

function hasOldUnixStyleFlags(allFlags: string[]) {
  for (const line of allFlags.map(line => line.split('\t'))) {
    const flag = line[0] as string;
    if (flag.startsWith('-') && !flag.startsWith('--')) {
      if (flag.length > 2) {
        return true;
      }
    }
  }
  return false;
}

function spiltShortFlags(flags: string[], shouldSplit: boolean): string[] {
  const newFlags : string[] = [];
  for (let flag of flags) {
    flag = flag.split('=')[0] as string;
    if (flag.startsWith('-') && !flag.startsWith('--')) {
      if (flag.length > 2 && shouldSplit) {
        newFlags.push(...flag.split('').map(f => '-' + f));
        continue;
      }
    }
    newFlags.push(flag);
  }
  return newFlags;
}

async function appendToCommand(commands: string[], subCommand: string): Promise<string[]> {
  const completions = await execSubCommandCompletions(...commands, ' '); // HERE
  if (completions.includes(subCommand)) {
    commands.push(subCommand);
    return commands;
  } else {
    return commands;
  }
}

export async function collectCommandString(current: Parser.SyntaxNode): Promise<string> {
  const commandNode = findFirstParent(current, n => isCommand(n));
  if (!commandNode) {
    return '';
  }
  const commandNodeText = commandNode.child(0)?.text;
  const subCommandName = commandNode.child(1)?.text;
  if (subCommandName?.startsWith('-')) {
    return commandNodeText || '';
  }
  const commandText = [commandNodeText, subCommandName].join('-');
  const docs = await execCommandDocs(commandText);
  if (docs) {
    return commandText;
  }
  return commandNodeText || '';
}