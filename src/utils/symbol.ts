import {
  DocumentSymbol,
  SymbolKind,
  // Range,
  DocumentUri,
} from 'vscode-languageserver';
import { BFSNodesIter, getRange } from './tree-sitter';
import { isVariableDefinitionName, isFunctionDefinitionName, refinedFindParentVariableDefinitionKeyword } from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope, getScope } from './definition-scope';
import { MarkdownBuilder, md } from './markdown-builder';
import { symbolKindToString } from './translation';
import { PrebuiltDocumentationMap } from './snippets';

export interface FishDocumentSymbol extends DocumentSymbol {
  uri: string;
  children: FishDocumentSymbol[];
  scope: DefinitionScope;
  node: SyntaxNode;
  mdCallback: () => string;
  get detail(): string;
}

function mdCallback(this: FishDocumentSymbol): string {
  const found = PrebuiltDocumentationMap.findMatchingNames(this.name, 'variable', 'command')?.find(name => name.name === this.name);
  // const moreInfo = !!found ? found.description + md.newline() + md.separator() : md.separator();
  const kindStr = `(${symbolKindToString(this.kind)})`;
  return new MarkdownBuilder().fromMarkdown(
    [
      md.bold(kindStr), '-', md.italic(this.name),
    ],
    md.separator(),
    md.codeBlock('fish', this.node.text),
    found
      ? md.newline() + md.separator() + md.newline() + found.description
      : '',
  ).toString();
}

function extractSymbolInfo(node: SyntaxNode): {
  shouldCreate: boolean;
  kind: SymbolKind;
  child: SyntaxNode;
  parent: SyntaxNode;

} {
  let shouldCreate = false;
  let kind: SymbolKind = SymbolKind.Null;
  let parent: SyntaxNode = node;
  let child: SyntaxNode = node;
  if (isVariableDefinitionName(child)) {
    parent = refinedFindParentVariableDefinitionKeyword(child)!.parent!;
    child = node;
    kind = SymbolKind.Variable;
    shouldCreate = !child.text.startsWith('$');
  } else if (child.firstNamedChild && isFunctionDefinitionName(child.firstNamedChild)) {
    parent = node;
    child = child.firstNamedChild!;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return { shouldCreate, kind, parent, child };
}

export function getFishDocumentSymbolItems(uri: DocumentUri, rootNode: SyntaxNode): FishDocumentSymbol[] {
  function getSymbols(...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];

    for (const current of Array.from(BFSNodesIter(...currentNodes))) {
      const childrenSymbols = getSymbols(...current.children);
      const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);
      if (shouldCreate) {
        symbols.push({
          name: child.text,
          kind,
          uri,
          node: current,
          range: getRange(parent),
          selectionRange: getRange(child),
          scope: getScope(uri, child),
          children: childrenSymbols ?? [] as FishDocumentSymbol[],
          mdCallback,
          get detail() {
            return this.mdCallback();
          },
        });
      }
    }
    return symbols;
  }

  return getSymbols(rootNode);
}

import { z } from 'zod';

const FishFunctionOptionSchema = z.object({
  argumentNames: z.array(z.string()).optional(),
  description: z.string().optional(),
  wraps: z.string().optional(),
  onEvent: z.string().optional(),
  onVariable: z.string().optional(),
  onJobExit: z.string().optional(),
  onProcessExit: z.string().optional(),
  onSignal: z.string().optional(),
  noScopeShadowing: z.boolean().optional(),
  inheritVariable: z.string().optional(),
});

export type FishFunctionOption = z.infer<typeof FishFunctionOptionSchema>;

const FishFunctionSchema = z.object({
  functionName: z.string(),
  options: FishFunctionOptionSchema,
});

export type FishFunction = z.infer<typeof FishFunctionSchema>;

// export function parseFishFunction(commandText: string): FishFunction {
//   const parts = commandText.split(/\s+/).filter(Boolean);
//   let functionName = '';
//   let options: FishFunctionOption = {};
//   let currentOption: keyof FishFunctionOption | null = null;
//
//   for (let i = 0; i < parts.length; i++) {
//     const part = parts[i];
//
//     if (i === 1) {
//       functionName = part;
//       continue;
//     }
//
//     switch (part) {
//       case '-a':
//       case '--argument-names':
//         currentOption = 'argumentNames';
//         options.argumentNames = [];
//         break;
//       case '-d':
//       case '--description':
//         currentOption = 'description';
//         options.description = '';
//         break;
//       case '-w':
//       case '--wraps':
//         currentOption = 'wraps';
//         break;
//       case '-e':
//       case '--on-event':
//         currentOption = 'onEvent';
//         break;
//       case '-v':
//       case '--on-variable':
//         currentOption = 'onVariable';
//         break;
//       case '-j':
//       case '--on-job-exit':
//         currentOption = 'onJobExit';
//         break;
//       case '-p':
//       case '--on-process-exit':
//         currentOption = 'onProcessExit';
//         break;
//       case '-s':
//       case '--on-signal':
//         currentOption = 'onSignal';
//         break;
//       case '-S':
//       case '--no-scope-shadowing':
//         options.noScopeShadowing = true;
//         currentOption = null;
//         break;
//       case '-V':
//       case '--inherit-variable':
//         currentOption = 'inheritVariable';
//         break;
//       default:
//         if (currentOption) {
//           if (currentOption === 'argumentNames') {
//             options.argumentNames!.push(part || '');
//           } else if (currentOption === 'description') {
//             options.description = (options.description || '') + ' ' + part;
//           } else {
//             options[currentOption] = part;
//             currentOption = null;
//           }
//         }
//     }
//   }
//
//   // Trim the description if it exists
//   if (options.description) {
//     options.description = options.description.trim();
//   }
//
//   return FishFunctionSchema.parse({ functionName, options });
// }
//
// export class DocumentationBuilder {
//   buildDocumentation(node: SyntaxNode, functionInfo: FishFunction): string {
//     let doc = `Function: ${functionInfo.functionName}\n`;
//
//     if (functionInfo.options.description) {
//       doc += `Description: ${functionInfo.options.description}\n`;
//     }
//
//     if (functionInfo.options.argumentNames) {
//       doc += `Arguments: ${functionInfo.options.argumentNames.join(', ')}\n`;
//     }
//
//     if (functionInfo.options.wraps) {
//       doc += `Wraps: ${functionInfo.options.wraps}\n`;
//     }
//
//     if (functionInfo.options.onEvent) {
//       doc += `On Event: ${functionInfo.options.onEvent}\n`;
//     }
//
//     if (functionInfo.options.onVariable) {
//       doc += `On Variable: ${functionInfo.options.onVariable}\n`;
//     }
//
//     if (functionInfo.options.onJobExit) {
//       doc += `On Job Exit: ${functionInfo.options.onJobExit}\n`;
//     }
//
//     if (functionInfo.options.onProcessExit) {
//       doc += `On Process Exit: ${functionInfo.options.onProcessExit}\n`;
//     }
//
//     if (functionInfo.options.onSignal) {
//       doc += `On Signal: ${functionInfo.options.onSignal}\n`;
//     }
//
//     if (functionInfo.options.noScopeShadowing) {
//       doc += `No Scope Shadowing: Yes\n`;
//     }
//
//     if (functionInfo.options.inheritVariable) {
//       doc += `Inherit Variable: ${functionInfo.options.inheritVariable}\n`;
//     }
//
//     return doc;
//   }
// }
