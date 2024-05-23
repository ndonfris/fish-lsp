import { execCmd, execEscapedCommand, execPrintLsp } from './utils/exec';
import { isCommand, isCommandName, isPipe } from './utils/node-types';
import { findFirstParent, firstAncestorMatch, getRange } from './utils/tree-sitter';
import { InlayHint, MarkupContent, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { containsRange } from './workspace-symbol';

// https://vscode-api.js.org/interfaces/vscode.InlayHintsProvider.html#onDidChangeInlayHints
// https://github.com/youngjuning/vscode-api.js.org/blob/9120b31/vscode.d.ts#L5174
export async function inlayHintsProvider(
  document: LspDocument,
  range: Range,
  analyzer: Analyzer,
): Promise<FishInlayHint[]> {
  const result: FishInlayHint[] = [];
  const nodes = analyzer.getNodes(document);

  const insideRange = (node: SyntaxNode) => containsRange(range, getRange(node));
  const isPrintableCommand = (node: SyntaxNode) => node.text.startsWith('printf') || node.text.startsWith('echo'); /* change to printflsp */
  const isStringCommand = (node: SyntaxNode) => node.text.startsWith('string');
  const isInlayHint = (node: SyntaxNode) => {
    if (isPipe(node)) {
      const first = node.firstNamedChild;
      const second = first?.nextNamedSibling;
      if (!first || !second) {
        return false;
      }
      return (
        isCommand(first) &&
          isCommand(second) &&
          isPrintableCommand(node) &&
          second.firstChild?.text === 'string'
      );
    }
  };

  const hintNodes: SyntaxNode[] = nodes
    .filter(insideRange)
    .filter(isInlayHint);
  await Promise.all(hintNodes.map(async (node) => {
    const text = node.text;
    const range = getRange(node).end;
    // try script escape in shell?
    // set privs to not have write access
    // read lines from file to store variables?
    //const out = await execCmd(`fish -i --command "${text.toString().trim()} | string escape --style=script --no-quoted"`)
    const out = await execPrintLsp(text);
    const value = !out || out.startsWith('Error') ? 'Error' : out;
    //const value = out.join().startsWith('Error') ? `{${out.join()}}`;
    const toolTip: MarkupContent = {
      kind: 'markdown',
      value: [
        '```fish',
        text,
        '```',
        '___',
        '```text',
        out,
        '```',
      ].join('\n'),
    };
    const item = FishInlayHint.create(value, range, toolTip);
    result.unshift(item);
  }));
  return result;
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

//import { DocumentUri, InlayHint, InlayHintKind, Range, } from 'vscode-languageserver';
//import { LspDocuments } from '../document';
//import { ConfigManager } from '../configManager';
//import { uriToPath } from '../utils/translation';
//import { Analyzer } from '../analyze';
//import {getRange, pointToPosition} from '../utils/tree-sitter';
//import * as Locations from '../utils/locations'
//import {isCommandName, isPipe} from '../utils/node-types';
//import {execInlayHintType} from '../utils/exec';
//import { SyntaxNode } from 'web-tree-sitter';
//
//export class FishInlayHintsProvider {
//
//    public static async provideInlayHints(
//        uri: DocumentUri,
//        range: Range,
//        documents: LspDocuments,
//        analyzer: Analyzer,
//        configurationMangaer: ConfigManager,
//    )   : Promise<InlayHint[]> {
//        const hints: InlayHint[] = [];
//
//        const file = uriToPath(uri);
//        if (!file) return hints;
//
//        const document = documents.get(file);
//        if (!document) return hints;
//
//        const isInlayHintNode = (node: SyntaxNode) => {
//            if (isPipe(node)) {
//                let first = node?.firstNamedChild
//                let second = first?.nextNamedSibling
//                if (!first || !second) return false
//                return (
//                    isCommandName(first) &&
//                    first.text === "printf" &&
//                    isCommandName(second) &&
//                    second.text === "string"
//                );
//            }
//            return false
//        }
//
//        const nodes = analyzer.getNodes(document).filter(isInlayHintNode)
//        console.log(nodes.map(t => t.text))
//        //const config = configurationMangaer.getInlayHintsEnabled();
//        //for (const node of nodes) {
//        //    let text = ''
//        //    text = await execInlayHintType(`type -t ${node.text} | cut -d ' ' -f1 2>/dev/null`)
//        //    const hint = InlayHint.create({line: node.startPosition.row, character: node.startPosition.column}, text, InlayHintKind.Type)
//        //    hint.paddingLeft = true
//        //    hints.push(hint)
//        //}
//        return hints;
//
//    }
//
//}
