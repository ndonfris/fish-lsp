import { execCmd } from 'utils/exec';
import { isCommandName, isPipe } from 'utils/node-types';
import { findFirstParent, getRange } from 'utils/tree-sitter';
import { InlayHint, MarkupContent, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
//import { FishShellInlayHintsProvider } from '/inlay-hints';
import { containsRange } from './workspace-symbol';

export class InlayHintsProvider {
  public async provideInlayHints(
    document: LspDocument,
    range: Range,
    analyzer: Analyzer,
  ): Promise<FishInlayHint[]> {
    const nodes = analyzer.getNodes(document);

    const insideRange = (node: SyntaxNode) => containsRange(range, getRange(node));
    const isInlayHint = (node: SyntaxNode) => {
      if (isPipe(node)) {
        const first = node.firstNamedChild;
        const second = first?.nextNamedSibling;
        if (!first || !second) {
          return false;
        }
        return (
          isCommandName(first) &&
            isCommandName(second) &&
            first.text === 'printf' &&
            second.text === 'string'
        );
      }
    };

    const hintNodes: SyntaxNode[] = [];
    nodes.filter(insideRange).filter(isInlayHint).forEach(node => {
      const rootPipe = findFirstParent(node, isPipe);
      if (!rootPipe) {
        return;
      }
      const rootPipeRange = getRange(rootPipe);
      const pos = rootPipeRange.start;
      if (hintNodes.some(hint => hint.startPosition.column === pos.line)) {
        return;
      }
      hintNodes.push(rootPipe);
    });

    const hints = await Promise.all(hintNodes.map(async (node) => {
      const text = node.text;
      const out = await execCmd(text);
      const value = `{${out.join(',')}}`;
      const toolTip: MarkupContent = {
        kind: 'markdown',
        value: [
          '```fish',
          text,
          '```',
          '---',
          '```text',
          ...out,
          '```',
        ].join('\n'),
      };
      return FishInlayHint.create(value, getRange(node).start, toolTip);
    }));
    return hints || [];
  }
}

export interface FishInlayHint extends InlayHint {
  label: string;
  position: { line: number; character: number; };
  paddingLeft: boolean;
  tooltip: MarkupContent;
}

export namespace FishInlayHint {

  export function create(
    label: string,
    position: { line: number; character: number; },
    toolTip: MarkupContent,
  ): FishInlayHint {
    return {
      label,
      position,
      paddingLeft: true,
      tooltip: toolTip,
    } as FishInlayHint;
  }
}
