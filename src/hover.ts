import * as LSP from 'vscode-languageserver';
import { Hover, MarkedString, MarkupKind } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { documentationHoverProvider, documentationHoverProviderForBuiltIns, enrichCommandWithFlags, enrichToCodeBlockMarkdown } from './documentation';
import { DocumentationCache } from './utils/documentationCache';
import { execCommandDocs, execComplete, execCompletions, execSubCommandCompletions } from './utils/exec';
import { isCommand, isCommandName } from './utils/node-types';
import { findEnclosingScope, findFirstParent, getNodeAtRange, getRange } from './utils/tree-sitter';

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
//  GOAL:
//       • remove or shrink documentationCache to compute these values on the fly
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

export async function handleHover(
  analyzer: Analyzer,
  document: LspDocument,
  position: LSP.Position,
  current: Parser.SyntaxNode,
  cache: DocumentationCache,
): Promise<LSP.Hover | null> {
  if (current.text.startsWith('-')) return await getHoverForFlag(current);

  const local = analyzer.getDefinition(document, position);
  if (local) return helperHoverBuilder(MarkupKind.Markdown, local.detail!, local.selectionRange)

  if (cache.find(current.text) !== undefined) {
    await cache.resolve(current.text);
    const item = cache.getItem(current.text);
    if (item?.docs) {
      return helperHoverBuilder(MarkupKind.Markdown, item.docs.toString())
    }
  }

  const commandString = await collectCommandString(current);
  return await documentationHoverProvider(commandString);
}

/**
 * Here is where we handle edge case hovering on any of the following examples:
 *
 *      find -type d -name abc                # old unix style
 *      ls --long --all                       # long flags
 *      ls -la                                # short flags (combined) 
 *
 */
export async function getHoverForFlag(current: Parser.SyntaxNode): Promise<Hover | null> {
  const commandNode = findFirstParent(current, n => isCommand(n));
  if (!commandNode) return null;

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
      continue;
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

  if (!commandNode) return '';

  const commandNodeText = commandNode.child(0)?.text;
  const subCommandName = commandNode.child(1)?.text;

  if (subCommandName?.startsWith('-')) return commandNodeText || '';

  const commandText = [commandNodeText, subCommandName].join('-');
  const docs = await execCommandDocs(commandText);

  if (docs) return commandText;

  return commandNodeText || '';
}

/**
 * @param kind - MarkupKind.Markdown | MarkupKind.plaintext
 * @param value - the string to display in the hover popup
 * @param range - An optional range inside the text document that is used to visualize the hover, e.g. by changing the background color.
 * @returns the LSP.Hover popup to display via the client
 */
function helperHoverBuilder(kind: MarkupKind, value: string, range?: LSP.Range): LSP.Hover {
  return {
    contents: {
      kind,
      value
    },
    range
  };
}

