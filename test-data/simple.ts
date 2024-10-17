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
    return dirname ? [dirname, filename].join('/') : filename;
  }

  /**
   * @param {string} documentUri - uri string
   * @returns {string} - full path of uri
   */
  export function absPath(documentUri: string): string {
    return documentUri.replace(/^file:\/\//, '');
  }

  /**
   * @param {LSP.Range} _range - range object
   * @returns array of range values [startLine, startCharacter, endLine, endCharacter]
   */
  export function range(_range: LSP.Range): RangeArr {
    return [_range.start?.line, _range.start?.character, _range.end?.line, _range.end?.character];
  }

  /**
   * @param {LSP.Position} position - position object
   * @returns array of position values [line, character]
   */
  export function position(position: LSP.Position): PositionArr {
    return [position.line, position.character];
  }

  /**
   * @param {PositionArr} position - position array
   * @returns LSP.Position object
   */
  export function toPosition(position: PositionArr): LSP.Position {
    return { line: position[0], character: position[1] };
  }

  /**
   * @param {RangeArr} _range - range array
   * @returns LSP.Range object
   */
  export function toRange(_range: RangeArr): LSP.Range {
    return {
      start: { line: _range[0], character: _range[1] },
      end: { line: _range[2], character: _range[3] },
    };
  }

  /**
   * @param {LSP.Location} location - location object
   * @returns uri and range values - { uri: string, range: [number, number, number, number] }
   */
  export function location(location: LSP.Location) {
    return {
      uri: relPath(location.uri),
      range: range(location.range),
    };
  }

  /**
   * @param {SyntaxNode} node - syntax node object
   * @returns object with node properties
   */
  export function node(node: SyntaxNode) {
    const shortText = node.text.split('\n').join(';').replace(/ {4}/g, '\\t');
    const text = shortText.length > 20 ? shortText.slice(0, 20) + '...' : shortText;
    return {
      type: node.type,
      text,
      start: position(pointToPosition(node.startPosition)),
      end: position(pointToPosition(node.endPosition)),
    };
  }

  /**
   * For logging purposes!
   *
   * show node properties, in a readable format
   *
   * @param {SyntaxNode} _node - syntax node object
   * @returns object with node properties
   */
  export function nodeVerbose(_node: SyntaxNode) {
    const childFixed = (_child: SyntaxNode) => {
      const child = node(_child);
      return {
        type: child.type,
        text: child.text,
        start: '[' + child.start[0] + ', ' + child.start[1] + ']',
        end: '[' + child.end[0] + ', ' + child.end[1] + ']',
      };
    };

    return {
      id: _node?.id,
      ...node(_node),
      parent: _node?.parent ? node(_node.parent) : null,
      firstChild: _node.firstChild ? node(_node?.firstChild) : null,
      lastChild: _node.lastChild ? node(_node.lastChild) : null,
      firstNamedChild: _node.firstNamedChild ? node(_node.firstNamedChild) : null,
      lastNamedChild: _node.lastNamedChild ? node(_node.lastNamedChild) : null,
      nextSibling: _node.nextSibling ? node(_node.nextSibling) : null,
      nextNamedSibling: _node.nextNamedSibling ? node(_node.nextNamedSibling) : null,
      previousSibling: _node.previousSibling ? node(_node.previousSibling) : null,
      previousNamedSibling: _node.previousNamedSibling ? node(_node.previousNamedSibling) : null,
      childCount: _node.childCount,
      children: _node.children.map(c => childFixed(c)),
      namedChildCount: _node.namedChildCount,
      namedChildren: _node.namedChildren.map(c => childFixed(c)),
      typeId: _node.typeId,
    };
  }

  /**
   * @param {FishDocumentSymbol} symbol - fish document symbol object
   * @returns object with symbol properties
   */
  export function symbol(symbol: FishDocumentSymbol) {
    return {
      name: symbol.name,
      uri: relPath(symbol.uri),
      kind: symbolKindToString(symbol.kind) as ReturnType<typeof symbolKindToString>,
      scope: symbol.scope.tag,
      range: range(symbol.range),
      selectionRange: range(symbol.selectionRange),
    };
  }
}