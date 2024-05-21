import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName } from '../utils/node-types';
import { getChildNodes, getRange, nodesGen } from '../utils/tree-sitter';
import { pathToRelativeFunctionName, uriInUserFunctions, uriToPath } from '../utils/translation';
import * as errorCodes from './errorCodes';
import { createDiagnostic } from './create';
import { LspDocument } from '../document';

/**
 * Check if the LspDocument is a user function for autoloading, and return the string
 * value of it.
 *     ~/.config/fish/functions/lsd.fish -> lsd
 */
function isAutoLoadedFunction(doc: LspDocument): string | null {
  const uri = uriToPath(doc.uri);
  if (!uri || !uriInUserFunctions(uri)) {
    return null;
  }
  return pathToRelativeFunctionName(uri);
}

/**
 * used to check if isAutoLoadedFunction is only seen one time
 */
const hasOnlyOneDefinition = (nodes: SyntaxNode[], name: string): boolean => {
  return nodes.filter(n => n.text === name).length === 1;
};

/**
 * collect duplicate nodes, in the list of function names of a document
 */
const duplicateNodeNames = (nodes: SyntaxNode[]): SyntaxNode[] => {
  const [dupes, seen] = [[], []] as [SyntaxNode[], SyntaxNode[]];
  for (const node of nodes) {
    if (seen.some(s => s.text === node.text)) {
      dupes.push(node);
    } else {
      seen.push(node);
    }
  }
  return dupes;
};

/**
 * takes the root node of a tree and its corresponding LspDocument. Returns a
 * list of all diagnostic errors for the document, including overlapping errors on the same range.
 * This means that the DiagnosticQueue will have to handle storing the errors is a manor that
 * makes sense to the client.
 *
 * @param {SyntaxNode} root - the root node of the tree
 * @param {TextDocumentItem} doc - the document of for the same tree
 * @returns {Diapgnostic[]} - a list of diagnostics for all functions that do not have a matching name
 */
export function createAllFunctionDiagnostics(root: SyntaxNode, doc: LspDocument): Diagnostic[] {
  const funcs = getChildNodes(root).filter(isFunctionDefinitionName);
  let possibleFuncsToFilenames : SyntaxNode[] = [];
  if (doc.isAutoLoaded() && !hasOnlyOneDefinition(funcs, doc.getAutoLoadName())) {
    possibleFuncsToFilenames = funcs.filter(n => n.text !== doc.getAutoLoadName());
  }
  const duplicateFuncNames : SyntaxNode[] = duplicateNodeNames(funcs);
  return [
    ...possibleFuncsToFilenames.map(n => createDiagnostic(n, errorCodes.missingAutoloadedFunctionName, doc)),
    ...duplicateFuncNames.map(n => createDiagnostic(n, errorCodes.duplicateFunctionName, doc)),
  ];
}

