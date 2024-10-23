import { SyntaxNode } from 'web-tree-sitter';
import { Range } from 'vscode-languageserver';
import * as Locations from '../utils/locations';
import { processArgparseCommand, processReadCommand, processSetCommand, Sym } from './symbol';

// export interface FishSymbol {
//   name: string;
//   kind: 'variable' | 'function';
//   uri: string;
//   node: SyntaxNode;
//   parent: SyntaxNode;
//   range: Range;
//   selectionRange: Range;
//   references: SyntaxNode[];
// }
//
// export class FishSymbol {
//   constructor(
//     public name: string,
//     public kind: 'variable' | 'function',
//     public uri: string,
//     public node: SyntaxNode,
//     public parent: SyntaxNode,
//     public range: Range,
//     public selectionRange: Range,
//   ) { }
//
//   static create(
//     name: string,
//     kind: 'variable' | 'function',
//     uri: string,
//     node: SyntaxNode,
//     parent: SyntaxNode,
//     range: Range,
//     selectionRange: Range,
//   ) {
//     return new FishSymbol(name, kind, uri, node, parent, range, selectionRange);
//   }
// }

export interface FishSymbol {
  name: string;
  kind: 'variable' | 'function';
  node: SyntaxNode;
}

export class FishSymbol {
  constructor(
    public name: string,
    public kind: 'variable' | 'function',
    public node: SyntaxNode,
  ) { }

  static create(
    name: string,
    kind: 'variable' | 'function',
    node: SyntaxNode,
  ) {
    return new FishSymbol(name, kind, node);
  }

  toString() {
    return `{ kind: ${this.kind.padEnd(10)}, name: ${this.name.padEnd(10)} }`;
  }
}

export class FishScope {
  public symbols: Map<string, FishSymbol[]> = new Map();
  public children: FishScope[] = [];
  public parent: FishScope | null = null;

  public copySymbols(): Map<string, FishSymbol[]> {
    const copy = new Map<string, FishSymbol[]>();
    for (const [key, value] of this.symbols) {
      copy.set(key, value);
    }
    return copy;
  }

  toString() {
    let str = '{\n  symbols: {\n';
    for (const [key, value] of this.symbols) {
      str += `    ${key}: ${value.map(v => v.toString()).join(', ')}\n`;
    }
    str += `  },\n  children: ${this.children.length}\n}`;
    return str;
  }
}

export function scopedSymbol(nodes: SyntaxNode[]): Sym[] {
  const results: Sym[] = [];
  for (const child of nodes) {
    const firstNamedChild = child.firstNamedChild as SyntaxNode;
    switch (child.type) {
      case 'function_definition':
        results.push(Sym.create(firstNamedChild.text, 'function', firstNamedChild));
        break;
      case 'command':
        switch (firstNamedChild.text) {
          case 'set':
            const setSymbol = processSetCommand(child);
            results.push(setSymbol);
            scope.symbols.set(setSymbol.name, [setSymbol]);
            break;
          case 'read':
            results.push(...processReadCommand(child));
            break;
          case 'argparse':
            results.push(...processArgparseCommand(child));
            break;
          default:
            break;
        }
        break;
      case 'program':
        break;
    }
  }

  return results;
}