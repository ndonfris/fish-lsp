import { SyntaxNode } from 'web-tree-sitter';
import { pointToPosition } from '../src/utils/tree-sitter';
import { FishDocumentSymbol } from '../src/utils/symbol';
import { symbolKindToString } from '../src/utils/translation';
import * as LSP from 'vscode-languageserver';

/***
 * A namespace for simplification of commonly distinguishable features
 * from language server objects, used for testing purposes
 */
export namespace Simple {

  /** [startLine, startCharacter, endLine, endCharacter] */
  type RangeArr = [ number, number, number, number ];

  /** [line, character] */
  type PositionArr = [ number, number ];

  /**
   * @param {string} documentUri - uri string
   * @returns {string} - relative path of uri
   */
  export function relPath(documentUri: string): string {
    const parts = documentUri.replace('^file://', '').split('/');
    const filename = parts.at(-1) || '';
    const dirname = parts.at(-2) || '';
    if (filename === 'config.fish') return filename;
    return !!dirname ? [ dirname, filename ].join('/') : filename;
  }

  /**
   * @param {string} documentUri - uri string
   * @returns {string} - full path of uri
   */
  export function absPath(documentUri: string): string {
    return documentUri.replace(/^file:\/\//, '');
  }

  /**
   * @param {LSP.Range} range - range object
   * @returns array of range values [startLine, startCharacter, endLine, endCharacter]
   */
  export function range(range: LSP.Range): RangeArr {
    return [ range.start.line, range.start.character, range.end.line, range.end.character ];
  }

  /**
   * @param {LSP.Position} position - position object
   * @returns array of position values [line, character]
   */
  export function position(position: LSP.Position): PositionArr {
    return [ position.line, position.character ];
  }

  /**
   * @param {PositionArr} position - position array
   * @returns LSP.Position object
   */
  export function toPosition(position: PositionArr): LSP.Position {
    return { line: position[ 0 ], character: position[ 1 ] };
  }

  /**
   * @param {RangeArr} range - range array
   * @returns LSP.Range object
   */
  export function toRange(range: RangeArr): LSP.Range {
    return {
      start: { line: range[ 0 ], character: range[ 1 ] },
      end: { line: range[ 2 ], character: range[ 3 ] },
    };
  }

  /**
   * @param {LSP.Location} location - location object
   * @returns uri and range values - { uri: string, range: [number, number, number, number] }
   */
  export function location(location: LSP.Location) {
    return {
      uri: Simple.relPath(location.uri),
      range: Simple.range(location.range),
    };
  }

  /**
   * @param {SyntaxNode} node - syntax node object
   * @returns object with node properties
   */
  export function node(node: SyntaxNode) {
    const shortText = node.text.split('\n').join(';').replace(/    /g, '\\t');
    let text = shortText.length > 20 ? shortText.slice(0, 20) + '...' : shortText;
    return {
      type: node.type,
      text,
      start: Simple.position(pointToPosition(node.startPosition)),
      end: Simple.position(pointToPosition(node.endPosition)),
    };
  }

  /**
   * For logging purposes!
   *
   * show node properties, in a readable format
   *
   * @param {SyntaxNode} node - syntax node object
   * @returns object with node properties
   */
  export function nodeVerbose(node: SyntaxNode) {

    const childFixed = (_child: SyntaxNode) => {
      const child = Simple.node(_child);
      return {
        type: child.type,
        text: child.text,
        start: '[' + child.start[0] + ', ' + child.start[1] + ']',
        end: '[' + child.end[0] + ', ' + child.end[1] + ']'
      }
    }

    return {
      id: node.id,
      ...Simple.node(node),
      parent: Simple.node(node.parent),
      firstChild: node.firstChild ? Simple.node(node.firstChild) : null,
      lastChild: node.lastChild ? Simple.node(node.lastChild) : null,
      firstNamedChild: node.firstNamedChild ? Simple.node(node.firstNamedChild) : null,
      lastNamedChild: node.lastNamedChild ? Simple.node(node.lastNamedChild) : null,
      nextSibling: node.nextSibling ? Simple.node(node.nextSibling) : null,
      nextNamedSibling: node.nextNamedSibling ? Simple.node(node.nextNamedSibling) : null,
      previousSibling: node.previousSibling ? Simple.node(node.previousSibling) : null,
      previousNamedSibling: node.previousNamedSibling ? Simple.node(node.previousNamedSibling) : null,
      childCount: node.childCount,
      children: node.children.map(c => childFixed(c)),
      namedChildCount: node.namedChildCount,
      namedChildren: node.namedChildren.map(c => childFixed(c)),
      typeId: node.typeId,
    };
  }

  /**
   * @param {FishDocumentSymbol} symbol - fish document symbol object
   * @returns object with symbol properties
   */
  export function symbol(symbol: FishDocumentSymbol) {
    return {
      name: symbol.name,
      uri: Simple.relPath(symbol.uri),
      kind: symbolKindToString(symbol.kind) as ReturnType<typeof symbolKindToString>,
      scope: symbol.scope.scopeTag,
      range: Simple.range(symbol.range),
      selectionRange: Simple.range(symbol.selectionRange)
    };
  }
}