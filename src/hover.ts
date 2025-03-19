import * as LSP from 'vscode-languageserver';
import { Hover, MarkupKind } from 'vscode-languageserver-protocol/node';
import * as Parser from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { documentationHoverProvider, enrichCommandWithFlags, enrichToMarkdown } from './documentation';
import { DocumentationCache } from './utils/documentation-cache';
import { execCommandDocs, execCompletions, execSubCommandCompletions } from './utils/exec';
import { findParent, findParentCommand, isCommand, isFunctionDefinition, isOption, isProgram, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName } from './utils/node-types';
import { findFirstParent } from './utils/tree-sitter';
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
  logger.log({ handleHover: handleHover.name, local, position, current });
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
  logger.log({ commandString, result });
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
