import { SymbolKind } from 'vscode-languageserver';
import Parser, { Point, SyntaxNode } from 'web-tree-sitter';
import { findParent, getChildNodes, getLastLeaf } from './tree-sitter';
import { findParentCommand, isComment, isFunctionDefinition, isInlineComment, isString } from './node-types';
import { initializeParser } from '../parser';
import { Analyzer } from '../future-analyze';
import { LspDocument } from '../document';



let cursorParser: Parser | null = null;

const setCurrentParser = async () => {
  if (!cursorParser) {
    cursorParser = await initializeParser();
  }
};



export class CursorAnalyzer {

  constructor(private parser: Parser) { }

  private getLineAsTree(line: string) {
    return this.parser.parse(line);
  }

  private getLastNode(tree: Parser.Tree) {
    return getLastLeaf(tree.rootNode);
  }

  private getCommandNode(tree: Parser.Tree) {
    const lastNode = this.getLastNode(tree);
    return findParentCommand(lastNode);
  }

  private getNodeType(node: Parser.SyntaxNode) {

  }

  private hasCommand(node: Parser.SyntaxNode) {
    return this.getCommandNode(node.tree) !== null;
  }

  private getArgumentIndex(
    command: Parser.SyntaxNode,
    point: Point,
  ): number {
    // If cursor is before command name, return -1
    if (point.row < command.startPosition.row ||
      point.row === command.startPosition.row &&
      point.column < command.startPosition.column) {
      return -1;
    }

    // If cursor is within or right after command name, return 0
    const commandName = command.firstNamedChild;
    if (!commandName ||
      point.row < commandName.endPosition.row ||
      point.row === commandName.endPosition.row &&
      point.column <= commandName.endPosition.column) {
      return 0;
    }

    // Start counting from 1 (after command name)
    let index = 1;

    // Examine each child after command name
    for (let i = 1; i < command.children.length; i++) {
      const child = command.children[i];
      if (!child) continue;

      // If cursor is before this child's end, we found our position
      if (point.row < child.endPosition.row ||
        point.row === child.endPosition.row &&
        point.column <= child.endPosition.column) {
        break;
      }
      index++;
    }

    return index;
  }

  getWord(
    node: Parser.SyntaxNode,
    point: Point,
  ) {
    if (node.isNamed) {
      return node.text;
    }

    const parent = node.parent;
    if (parent && parent.isNamed) {
      return parent.text;
    }

    return '';
  }


  get() {

    return {
      word: '',
      command: '',
      line: '',
      lineTextBeforeCursor: '',
      documentTextBeforeCursor: '',
      commandNode: null,
      currentNode: null,
      currentNodeType: '',
      lastNode: null,
      argumentIndex: 0,
      type: SymbolKind.Null,
      hasCommand: false,
    };
  }


}


function getArgumentIndex(
  command: Parser.SyntaxNode,
  point: Point,
): number {
  // If cursor is before command name, return -1
  if (point.row < command.startPosition.row ||
    point.row === command.startPosition.row &&
    point.column < command.startPosition.column) {
    return -1;
  }

  // If cursor is within or right after command name, return 0
  const commandName = command.firstNamedChild;
  if (!commandName ||
    point.row < commandName.endPosition.row ||
    point.row === commandName.endPosition.row &&
    point.column <= commandName.endPosition.column) {
    return 0;
  }

  // Start counting from 1 (after command name)
  let index = 1;

  // Examine each child after command name
  for (let i = 1; i < command.children.length; i++) {
    const child = command.children[i];
    if (!child) continue;

    // If cursor is before this child's end, we found our position
    if (point.row < child.endPosition.row ||
      point.row === child.endPosition.row &&
      point.column <= child.endPosition.column) {
      break;
    }
    index++;
  }

  return index;
}

export function getCursorAnalysis(
  analyzer: Analyzer,
  document: LspDocument,
  line: number,
  character: number,
) {
  const cached = analyzer.cached.get(document.uri);
  if (!cached) return null;

  const lineText = document.getLineBeforeCursor({ line, character });
  const documentText = document.getTextBeforeCursor({ line, character });
  const lineTree = cursorParser?.parse(documentText);


  if (!lineTree) return null;

  let lastNode: SyntaxNode | null = null;
  for (const node of getChildNodes(lineTree.rootNode)) {
    lastNode = node;
  }

  const currentNode = analyzer.nodeAtPoint(document.uri, line, character);
  const commandNode = lastNode ? findParentCommand(lastNode) : null;

  const argumentIndex = commandNode ? getArgumentIndex(commandNode, { row: line, column: character }) : 0;

  return {
    word: '',
    command: commandNode?.firstChild?.text || '',
    line: lineText,
    textBeforeCursor: documentText,
    entireLine: document.getLine(line),
    lastNode,
    commandNode,
    currentNode,
    argumentIndex,
    checkType: {
      hasCommand: () => !!commandNode,
      isVariableDefinition: () => commandNode && ['set', 'read'].includes(commandNode.text) || false,
      isFunctionDefinition: () => commandNode && isFunctionDefinition(commandNode) || false,
      getCommandName: () => commandNode?.firstChild?.text || '',
      endswithSpace: () => lineText.endsWith(' '),
      endswithSemicolon: () => lineText.endsWith(';'),
      insideComment: () => {
        if (currentNode && currentNode.type === 'comment') return true;
        const firstCheck = currentNode && findParent(currentNode, isComment || isInlineComment) !== null;
        if (firstCheck) return true;
        const secondCheck = lastNode && findParent(lastNode, isComment || isInlineComment) !== null;
        return secondCheck
      },
      insideString: () => {
        if (currentNode && isString(currentNode)) return true;
        if (currentNode && findParent(currentNode, isString) !== null) {
          return true;
        };
        if (lastNode && findParent(lastNode, isString) !== null) {
          return true;
        }
        return false;
      },
      insideFunction: () => {
        if (currentNode && isFunctionDefinition(currentNode)) return true;
        if (currentNode && findParent(currentNode, isFunctionDefinition) !== null) {
          return true;
        };
        if (lastNode && findParent(lastNode, isFunctionDefinition) !== null) {
          return true;
        }
        return false;
      },
      hasStatementKeyword: () => {
        if (!commandNode) return false;
        const commandName = commandNode.firstChild;
        if (!commandName) return false;
        return ['set', 'read'].includes(commandName.text);
      },
    }
  };

}