import { InlayHint, InlayHintKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { isCommand, isCommandName, isReturn } from './utils/node-types';
import { findChildNodes } from './utils/tree-sitter';

export async function getStatusInlayHints(root: SyntaxNode): Promise<InlayHint[]> {
  const hints: InlayHint[] = [];
  const returnStatements = findChildNodes(root, isReturn);

  for (const returnStmt of returnStatements) {
    const status = getReturnStatusValue(returnStmt);
    if (status) {
      hints.push({
        position: {
          line: returnStmt.endPosition.row,
          character: returnStmt.endPosition.column,
        },
        kind: InlayHintKind.Parameter,
        label: ` → ${status.inlineValue}`,
        paddingLeft: true,
        tooltip: {
          kind: 'markdown',
          value: `Status code ${status.tooltip.code}: ${status.tooltip.description}`,
        },
      });
    }
  }

  return hints;
}

export function findReturnNodes(root: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (isReturn(node)) {
      nodes.push(node);
    }
    queue.push(...node.children);
  }

  return nodes;
}

function getStatusDescription(status: string): string {
  const statusMap: Record<string, string> = {
    0: 'Success',
    1: 'General error',
    2: 'Misuse of shell builtins',
    126: 'Command invoked cannot execute',
    127: 'Command not found',
    128: 'Invalid exit argument',
    130: 'Script terminated by Control-C',
  };
  return statusMap[status] || `Exit code ${status}`;
}

export function getReturnStatusValue(returnNode: SyntaxNode): {
  inlineValue: string;
  tooltip: {
    code: string;
    description: string;
  };
} | undefined {
  const statusArg = returnNode.children.find(child =>
    !isCommand(child) && !isCommandName(child) && child.type === 'integer');

  if (!statusArg?.text) return undefined;

  const statusInfo = PrebuiltDocumentationMap.getByName(statusArg.text).pop();
  const statusInfoShort = getStatusDescription(statusArg.text);

  return statusInfoShort ? {
    inlineValue: statusInfoShort,
    tooltip: {
      code: statusInfo?.name || statusArg.text,
      description: statusInfo?.description || statusInfoShort,
    },
  } : undefined;
}
