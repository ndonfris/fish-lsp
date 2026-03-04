import * as LSP from 'vscode-languageserver';
import { Hover, MarkupKind } from 'vscode-languageserver-protocol/node';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { documentationHoverProvider, enrichCommandWithFlags, enrichToCodeBlockMarkdown, enrichToMarkdown } from './documentation';
import { DocumentationCache } from './utils/documentation-cache';
import { execCommandDocs, execCompletions, execSubCommandCompletions } from './utils/exec';
import { subcommandCache } from './utils/subcommand-cache';
import { findParent, findParentCommand, isCommand, isFunctionDefinition, isOption, isProgram, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName } from './utils/node-types';
import { findFirstParent, nodeLogFormatter } from './utils/tree-sitter';
import { symbolKindsFromNode, uriToPath } from './utils/translation';
import { logger } from './logger';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { md } from './utils/markdown-builder';
import { AutoloadedPathVariables } from './utils/process-env';

export async function handleHover(
  analyzer: Analyzer,
  document: LspDocument,
  position: LSP.Position,
  current: Parser.SyntaxNode,
  cache: DocumentationCache,
): Promise<LSP.Hover | null> {
  if (isOption(current)) {
    return await getHoverForFlag(current);
  }
  const local = analyzer.getDefinition(document, position);
  logger.log({
    handleHover: handleHover.name,
    symbol: local?.name,
    position,
    current: nodeLogFormatter(current),
  });
  if (local) {
    return {
      contents: local.toMarkupContent(),
      range: local.selectionRange,
    };
  }
  const { kindType, kindString } = symbolKindsFromNode(current);
  const symbolType = ['function', 'class', 'variable'].includes(kindString) ? kindType : undefined;

  if (cache.find(current.text) !== undefined) {
    await cache.resolve(current.text, document.uri, symbolType);
    const item = symbolType ? cache.find(current.text, symbolType) : cache.getItem(current.text);
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
  logger.log({ handleHover: 'handleHover()', commandString, result });
  if (result) return result;

  // Fallback: when hovering on a subcommand token (child(1) of a command node)
  // and no subcommand-specific docs were found, try to extract the relevant
  // section from the parent command's man page. Falls back to showing the
  // full parent man page if no focused section is found.
  if (current.parent?.type === 'command' && current.parent.child(0) !== current) {
    const parentCmdName = current.parent.child(0)?.text;
    if (parentCmdName) {
      const parentDocs = await execCommandDocs(parentCmdName);
      if (parentDocs) {
        const section = extractManPageSection(parentDocs, current.text);
        if (section) {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: [
                md.codeBlock('fish', `${parentCmdName} ${current.text}`),
                md.separator(),
                md.codeBlock('man', section),
                md.separator(),
                [md.italic('full man page'), '-', md.bold(`${parentCmdName}(1)`)].join(' '),
                md.separator(),
                md.codeBlock('man', parentDocs),
              ].join('\n\n'),
            },
          };
        }
        return { contents: enrichToCodeBlockMarkdown(parentDocs, 'man') };
      }
    }
  }

  return null;
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

  /** find exact match for command */
  const prebuiltDocs = PrebuiltDocumentationMap.findMatchingNames(
    commandStr.join('-'),
    'command',
  ).find(doc => doc.name === commandStr.join('-'));
  const description = !prebuiltDocs ? '' : prebuiltDocs?.description || '';
  return {
    contents: enrichCommandWithFlags(commandStr.join('-'), description, found),
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
  const newFlags: string[] = [];
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

/**
 * Extract a focused section from a man page for a specific subcommand.
 *
 * Supports two man page formats:
 *
 * 1. Indented entry style (e.g. `status`):
 *    ` is-full-job-control or --is-full-job-control`
 *    `        Returns 0 if full job control is enabled.`
 *
 * 2. Uppercase header style (e.g. `path`):
 *    `NORMALIZE SUBCOMMAND`
 *    `    path normalize [-z | --null-in] ...`
 *
 * Returns null if no matching section is found.
 */
export function extractManPageSection(manText: string, subcommand: string): string | null {
  return extractIndentedEntrySection(manText, subcommand)
      ?? extractUppercaseHeaderSection(manText, subcommand);
}

/**
 * Match `NORMALIZE SUBCOMMAND` style headers (used by `path`).
 * Collects everything until the next top-level uppercase header.
 */
function extractUppercaseHeaderSection(manText: string, subcommand: string): string | null {
  const lines = manText.split('\n');
  const upper = subcommand.toUpperCase();
  const headerPattern = /^[A-Z][A-Z0-9 -]+ SUBCOMMANDS?$/;
  let collecting = false;
  const result: string[] = [];

  for (const line of lines) {
    if (!collecting) {
      if (headerPattern.test(line) && line.includes(upper)) {
        collecting = true;
        result.push(line);
      }
    } else {
      // Stop at the next top-level all-caps header
      if (line.length > 0 && /^[A-Z][A-Z0-9 -]+$/.test(line)) {
        break;
      }
      result.push(line);
    }
  }

  while (result.length > 0 && result[result.length - 1]!.trim() === '') {
    result.pop();
  }

  return result.length > 0 ? result.join('\n') : null;
}

/**
 * Match indented entry style (used by `status`):
 * ` is-full-job-control or --is-full-job-control`
 * followed by deeper-indented description lines.
 */
function extractIndentedEntrySection(manText: string, subcommand: string): string | null {
  const lines = manText.split('\n');
  let collecting = false;
  let sectionIndent = -1;
  const result: string[] = [];

  for (const line of lines) {
    if (!collecting) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith(subcommand) && /^\s+/.test(line)) {
        const indent = line.length - trimmed.length;
        const afterName = trimmed[subcommand.length];
        if (afterName === undefined || afterName === ' ' || afterName === ',' || afterName === '\t') {
          collecting = true;
          sectionIndent = indent;
          result.push(line);
        }
      }
    } else {
      if (line.trim() === '') {
        result.push(line);
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent > sectionIndent) {
        result.push(line);
      } else {
        break;
      }
    }
  }

  while (result.length > 0 && result[result.length - 1]!.trim() === '') {
    result.pop();
  }

  return result.length > 0 ? result.join('\n') : null;
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
  // Fast path: use cached subcommand data to avoid async fish subprocess
  if (commandNodeText && subCommandName && subcommandCache.hasSubcommand(commandNodeText, subCommandName)) {
    return `${commandNodeText} ${subCommandName}`;
  }
  const commandText = [commandNodeText, subCommandName].filter(Boolean) as string[];
  const docs = await execCommandDocs(...commandText);
  if (docs) {
    return commandText.join(' ');
  }
  return commandNodeText || '';
}

const allVariables = PrebuiltDocumentationMap.getByType('variable');
export function isPrebuiltVariableExpansion(node: Parser.SyntaxNode): boolean {
  if (isVariableExpansion(node)) {
    const variableName = node.text.slice(1);
    return allVariables.some(variable => variable.name === variableName);
  }
  return false;
}

export function getPrebuiltVariableExpansionDocs(node: Parser.SyntaxNode): LSP.MarkupContent | null {
  if (isVariableExpansion(node)) {
    const variableName = node.text.slice(1);
    const variable = allVariables.find(variable => variable.name === variableName);
    if (variable) {
      return enrichToMarkdown([
        `(${md.italic('variable')}) - ${md.inlineCode('$' + variableName)}`,
        md.separator(),
        variable.description,
      ].join('\n'));
    }
  }
  return null;
}

export const variablesWithoutLocalDocumentation = [
  '$status',
  '$pipestatus',
];

export function getVariableExpansionDocs(analyzer: Analyzer, doc: LspDocument, position: LSP.Position) {
  function isVariablesWithoutLocalDocumentation(current: Parser.SyntaxNode) {
    return variablesWithoutLocalDocumentation.includes('$' + current.text);
  }

  /**
   * Use this to append prebuilt documentation to variables with local documentation
   */
  function getPrebuiltVariableHoverContent(current: Parser.SyntaxNode): string | null {
    const docObject = allVariables.find(variable => variable.name === current.text);
    if (!docObject) return null;
    return [
      `(${md.italic('variable')}) ${md.bold(current.text)}`,
      md.separator(),
      docObject.description,
    ].join('\n');
  }

  return function isPrebuiltExpansionDocsForVariable(current: Parser.SyntaxNode) {
    if (isVariableDefinitionName(current)) {
      const variableName = current.text;
      const parent = findParentCommand(current);
      if (AutoloadedPathVariables.has(variableName)) {
        return {
          contents: enrichToMarkdown(
            [
              AutoloadedPathVariables.getHoverDocumentation(variableName),
              md.separator(),
              md.codeBlock('fish', parent?.text || ''),
            ].join('\n'),
          ),
        };
      }
      if (isVariablesWithoutLocalDocumentation(current)) {
        return {
          contents: enrichToMarkdown([
            getPrebuiltVariableHoverContent(current),
            md.separator(),
            md.codeBlock('fish', parent?.text || ''),
          ].join('\n')),
        };
      }
      if (allVariables.find(variable => variable.name === current.text)) {
        return {
          contents: enrichToMarkdown([
            getPrebuiltVariableHoverContent(current),
            md.separator(),
            md.codeBlock('fish', parent?.text || ''),
          ].join('\n')),
        };
      }
      return null;
    }
    if (current.type === 'variable_name' && current.parent && isVariableExpansion(current.parent)) {
      const variableName = current.text;
      if (AutoloadedPathVariables.has(variableName)) {
        return {
          contents: enrichToMarkdown(
            AutoloadedPathVariables.getHoverDocumentation(variableName),
          ),
        };
      }
      // argv
      const node = current.parent;
      if (isVariableExpansionWithName(node, 'argv')) {
        const parentNode = findParent(node, (n) => isProgram(n) || isFunctionDefinition(n)) as Parser.SyntaxNode;
        const variableName = node.text.slice(1);
        const variableDocObj = allVariables.find(variable => variable.name === variableName);
        if (isFunctionDefinition(parentNode)) {
          const functionName = parentNode.firstNamedChild!;
          return {
            contents: enrichToMarkdown([
              `(${md.italic('variable')}) ${md.bold('$argv')}`,
              `argument of function ${md.bold(functionName.text)}`,
              md.separator(),
              variableDocObj?.description,
              md.separator(),
              md.codeBlock('fish', parentNode.text),
            ].join('\n')),
          };
        } else if (isProgram(parentNode)) {
          return {
            contents: enrichToMarkdown([
              `(${md.italic('variable')}) ${md.bold('$argv')}`,
              `arguments of script ${md.bold(uriToPath(doc.uri))}`,
              md.separator(),
              variableDocObj?.description,
              md.separator(),
              md.codeBlock('fish', parentNode.text),
            ].join('\n')),
          };
        }
      } else if (variablesWithoutLocalDocumentation.includes(node.text)) {
        // status && pipestatus
        return { contents: getPrebuiltVariableExpansionDocs(node)! };
      } else if (!analyzer.getDefinition(doc, position) && isPrebuiltVariableExpansion(node)) {
        // variables which aren't defined in lsp's scope, but are documented
        const contents = getPrebuiltVariableExpansionDocs(node);
        if (contents) return { contents };
      }
      // consider enhancing variables with local documentation's, with their prebuilt documentation
    }
    return null;
  };
}
