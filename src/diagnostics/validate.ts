import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { findParentCommand, isClause, isCommand, isCommandName, isConditionalCommand, isEnd, isError, isFunctionDefinition, isFunctionDefinitionName, isIfStatement, isNewline, isPossibleUnreachableStatement, isReturn, isScope, isStatement, isVariable, isVariableDefinition } from '../utils/node-types';
import { findFirstNamedSibling, nodesGen } from '../utils/tree-sitter';
import { createDiagnostic } from './create';
import { createAllFunctionDiagnostics } from './missingFunctionName';
import { getExtraEndSyntaxError, getMissingEndSyntaxError } from './syntaxError';
import { getUniversalVariableDiagnostics } from './universalVariable';
import * as errorCodes from './errorCodes';
import { pathVariable } from './errorCodes';
import { buildStatementChildren } from './statementHasReturn';

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) : Diagnostic[] {
  const diagnostics: Diagnostic[] = createAllFunctionDiagnostics(root, doc);
  for (const child of nodesGen(root)) {
    const diagnostic =
            getMissingEndSyntaxError(child) ||
            getExtraEndSyntaxError(child) ||
            //getUnreachableCodeSyntaxError(child) ||
            getUniversalVariableDiagnostics(child, doc);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

export function collectDiagnosticsRecursive(root: SyntaxNode, doc: LspDocument) : Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const functionNames: string[] = [];
  const variableNames: Set<string> = new Set();
  collectAllDiagnostics(root, doc, diagnostics, functionNames, variableNames);
  return diagnostics;
}

function isMissingEnd(node: SyntaxNode) : Diagnostic | null {
  const last = node.lastChild || node.lastNamedChild || node;
  return isError(node) && !isEnd(last)
    ? createDiagnostic(node, errorCodes.missingEnd)
    : null;
}

function isExtraEnd(node: SyntaxNode) : Diagnostic | null {
  return isCommandName(node) && node.text === 'end'
    ? createDiagnostic(node, errorCodes.extraEnd)
    : null;
}

function isSyntaxError(node: SyntaxNode, diagnostic: Diagnostic | null) : Diagnostic | null {
  if (!isError(node) || !!diagnostic) {
    return diagnostic;
  }
  return isError(node)
    ? createDiagnostic(node, errorCodes.syntaxError)
    : null;
}

function collectEndError(node: SyntaxNode, diagnostics: Diagnostic[]): boolean {
  let didAdd = false;
  let endError = isMissingEnd(node) || isExtraEnd(node);
  if (!endError) {
    endError = isSyntaxError(node, endError);
  }
  if (endError) {
    diagnostics.push(endError);
    didAdd = true;
  }
  return didAdd;
}

// check if code is reachable
export function collectFunctionsScopes(func: SyntaxNode, doc: LspDocument, diagnostics: Diagnostic[]): boolean {
  if (!isFunctionDefinition(func)) {
    return false;
  }
  //const nodes = node.namedChildren.filter((c) => isStatement(c) || isCommandName(c))
  let hasRets = false;
  for (const node of func.namedChildren) {
    if (!hasRets && isStatement(node)) {
      hasRets = checkAllStatements(node);
      continue;
    }
    if (hasRets) {
      diagnostics.push(createDiagnostic(node, errorCodes.unreachableCode, doc));
    }
  }
  return hasRets;
}

// check if code is reachable
function checkAllStatements(statementNode: SyntaxNode): boolean {
  const statements = [statementNode, ...statementNode.namedChildren.filter(c => isClause(c))];
  for (const statement of statements) {
    if (!checkStatement(statement, [])) {
      return false;
    }
  }
  return true;
}

function checkStatement(root: SyntaxNode, collection: SyntaxNode[]) {
  let shouldReturn = isReturn(root);
  for (const child of buildStatementChildren(root)) {
    const include = checkStatement(child, collection) || isReturn(child);
    if (isStatement(child) && !include) {
      return false;
    }
    shouldReturn = include || shouldReturn;
  }
  if (shouldReturn) {
    collection.push(root);
  }
  return shouldReturn;
}

/**
 * @TODO: make sure you test switch statement, because I assume that this will need a minor
 * tweak, to handle recognizing the case_clause of \* or '*'
 *
 * Recursively descends, collecting return statements in each statement block. Starts with
 * root a isStatement(if/else if/else, switch/case), and then exhaustively checks if the
 * statement block returns on every path. If it does, we use the other statements, we
 * retrieved in collecFunctionScopes (already sorted), and publish unreachable diagnostics
 * to them.
 *
 * Important, note about the fish-shell AST from tree-sitter:
 * if_statement and switch_statement will be root nodes, but else_if_clause/else_clause/case_clause,
 * are importantly named as children nodes (or clauses).
 */
function completeStatementCoverage(root: SyntaxNode, collection: SyntaxNode[]) {
  let shouldReturn = isReturn(root);
  for (const child of buildStatementChildren(root)) {
    const include = completeStatementCoverage(child, collection) || isReturn(child);
    if (isStatement(child) && !include) {
      return false;
    }
    shouldReturn = include || shouldReturn;
  }
  if (shouldReturn) {
    collection.push(root);
  }
  return shouldReturn;
}

/**
 * 3 main cases:
 *   1.) check for duplicate functions
 *   2.) check for first function in an autoloaded uri-path that does not match the
 *       autoload name.
 *   3.) Will give a diagnostic for applying '__' to helper functions, for uniqueue
 *       signature across the workspace.
 */
export function collectFunctionNames(node: SyntaxNode, doc: LspDocument, diagnostics: Diagnostic[], functionNames: string[]) : boolean {
  let didAdd = false;
  const name : string = node.text;
  if (!isFunctionDefinitionName(node)) {
    return didAdd;
  }
  functionNames.push(name);
  const needsAutoloadName = doc.isAutoLoaded();
  const hasAutoloadName = needsAutoloadName && functionNames.includes(doc.getAutoLoadName());
  if (functionNames.filter(n => n === name).length > 1) {
    diagnostics.push(createDiagnostic(node, errorCodes.duplicateFunctionName));
    didAdd = true;
  }
  if (needsAutoloadName) {
    if (!hasAutoloadName && functionNames.length === 1) {
      diagnostics.push(createDiagnostic(node, errorCodes.missingAutoloadedFunctionName));
      return true;
    } else if (needsAutoloadName && doc.getAutoLoadName() !== name && !name.startsWith('_')) {
      diagnostics.push(createDiagnostic(node, errorCodes.privateHelperFunction));
      didAdd = true;
    }
  }
  return didAdd;
}

function findVariableFlagsIfSeen(node: SyntaxNode, shortOpts: string[], longOpts: string[]) : SyntaxNode | null {
  if (!isVariableDefinition(node)) {
    return null;
  }
  const isUniveralOption = (n: SyntaxNode) => {
    if (n.text.startsWith('--')) {
      return longOpts.some(opt => n.text === `--${opt}`);
    }
    if (!n.text.startsWith('--') && n.text.startsWith('-')) {
      return shortOpts.some(short => n.text.includes(short));
    }
    return false;
  };
  const universalFlag = findFirstNamedSibling(node, isUniveralOption);
  return universalFlag;
}

function getPathVariable(node: SyntaxNode, document: LspDocument, seen: Set<string>): Diagnostic | null {
  let pathVariable: Diagnostic | null = null;
  if (!isVariableDefinition(node)) {
    null;
  }
  const pathFlag = findVariableFlagsIfSeen(node, [], ['path', 'unpath']);
  if (!pathFlag && node.text.endsWith('PATH')) {
    pathVariable = createDiagnostic(node, errorCodes.pathVariable, document);
    seen.add(node.text);
  }
  if (pathFlag && !node.text.endsWith('PATH')) {
    pathVariable = createDiagnostic(node, errorCodes.pathFlag, document);
    seen.add(node.text);
  }
  return pathVariable;
}

function getUniversalVariable(node: SyntaxNode, document: LspDocument, seen: Set<string>): Diagnostic | null {
  if (!isVariableDefinition(node)) {
    return null ;
  }
  const univeralFlag = findVariableFlagsIfSeen(node, ['U'], ['universal']);
  if (!univeralFlag) {
    return null ;
  }
  seen.add(node.text);
  return createDiagnostic(univeralFlag, errorCodes.universalVariable, document);
}

function collectVariableNames(node: SyntaxNode, document: LspDocument, diagnostics: Diagnostic[], varsSeen: Set<string>) {
  if (!isVariableDefinition(node)) {
    return false;
  }
  const diagnostic = getUniversalVariable(node, document, varsSeen) || getPathVariable(node, document, varsSeen);
  if (!diagnostic) {
    return false;
  }
  diagnostics.push(diagnostic);
  return true;
}

function collectReturnError(node: SyntaxNode, diagnostic: Diagnostic[]) {
  if (isReturn(node)) {
    return false;
  }
  let currentNode : SyntaxNode | null = node;
  const siblings: SyntaxNode[] = [];
  while (currentNode) {
    if (isStatement(currentNode) || isEnd(currentNode)) {
      break;
    }
    if (isReturn(currentNode) && siblings.length === 0) {
      currentNode = currentNode.nextNamedSibling;
      continue;
    } else if (isNewline(currentNode)) {
      currentNode = currentNode.nextNamedSibling;
      continue;
    }
    siblings.push(currentNode);
    currentNode = currentNode.nextNamedSibling;
  }
  let stillChaining = true;  // an example of chianing -> echo "$foo" ; and return 0
  for (const sibling of siblings) {
    if (isStatement(sibling) || isEnd(sibling)) {
      break;
    } else if (!stillChaining) {
      diagnostic.push(createDiagnostic(sibling, errorCodes.unreachableCode));
      continue;
    } else if (stillChaining) {
      if (!isConditionalCommand(sibling) && !isStatement(sibling)) {
        stillChaining = false;
        diagnostic.push(createDiagnostic(sibling, errorCodes.unreachableCode));
      } else {
        continue;
      }
    }
  }
  return true;
}

export function collectAllDiagnostics(root: SyntaxNode, doc: LspDocument, diagnostics: Diagnostic[], functionNames: string[], variableNames: Set<string>) : boolean {
  let shouldAdd = collectEndError(root, diagnostics)
        || collectFunctionNames(root, doc, diagnostics, functionNames)
        || collectVariableNames(root, doc, diagnostics, variableNames);
  //|| collectFunctionsScopes(root, doc, diagnostics) // DOES NOT HANDLE if without ELSE
  //|| collectReturnError(root, diagnostics)          // BROKEN
  //collectReturnError(root, diagnostics);
  for (const node of root.children) {
    shouldAdd = collectAllDiagnostics(node, doc, diagnostics, functionNames, variableNames);
  }
  return shouldAdd;
}
