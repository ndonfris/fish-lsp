// Define the AbstractTree class with a constraint on the generic type
export type TNode = {
  children: TNode[];
};

export type TreeRemoveOptions = {
  keepChildren?: boolean;
};

const defaultRemoveOptions: TreeRemoveOptions = {
  keepChildren: true,
};

export class GenericTree<T extends TNode> {
  private _tree: T[] = [];

  constructor(tree: T[]) {
    this._tree = tree;
  }

  copy(): GenericTree<T> {
    return new GenericTree<T>(Array.from(this._tree));
  }

  forEach(callback: (node: T) => void) : void {
    for (const n of this.iter()) {
      callback(n);
    }
  }

  iter(): Iterable<T> {
    function* iterNode(...nodes: T[]) : Iterable<T> {
      for (const n of nodes) {
        yield n;
        yield* iterNode(...n.children as T[]);
      }
    }
    return iterNode(...Array.from(this._tree));
  }

  filter(callback: (node: T) => boolean): T[] {
    function innerFilter(nodes: T[], callback: (node: T) => boolean): T[] {
      const result: T[] = [];
      for (const n of nodes) {
        const children = innerFilter(n.children as T[], callback);
        if (callback(n)) {
          const newNode : T = { ...n, children };
          result.push(newNode);
          continue;
        }
        if (children.length > 0) {
          result.push(...children);
        }
      }
      return result;
    }

    return innerFilter(this._tree, callback);
  }

  filterToTree(callback: (node: T) => boolean): GenericTree<T> {
    return new GenericTree<T>(this.filter(callback));
  }

  includes(callback: (node: T) => boolean): boolean {
    for (const n of this.iter()) {
      if (callback(n)) {
        return true;
      }
    }
    return false;
  }

  map<U>(callback: (node: T) => U): U[] {
    const result: U[] = [];
    for (const n of this.iter()) {
      result.push(callback(n));
    }
    return result;
  }

  find(callback: (node: T) => boolean): T | undefined {
    for (const n of this.iter()) {
      if (callback(n)) {
        return n;
      }
    }
    return undefined;
  }

  findAll(callback: (node: T) => boolean): T[] {
    const result : T[] = [];
    for (const n of this.iter()) {
      if (callback(n)) {
        result.push(n);
      }
    }
    return result;
  }

  toArray(): T[] {
    return Array.from(this._tree);
  }

  toFlatArray(): T[] {
    const result: T[] = [];
    for (const n of this.iter()) {
      result.push(n);
    }
    return result;
  }

  get flatLength(): number {
    return this.toFlatArray().length;
  }

  findParents(toFind: T, equalsCallback: (a: T, b: T) => boolean) : T[] {
    function hasChild(node: T, toFind: T) : boolean {
      if (equalsCallback(node, toFind)) {
        return true;
      }
      for (const n of node.children as T[]) {
        if (hasChild(n, toFind)) {
          return true;
        }
      }
      return false;
    }

    return this.filterToTree((node: T) => hasChild(node, toFind)).toFlatArray();
  }

  remove(toRemove: T, equalsCallback: (a: T, b: T) => boolean, options: TreeRemoveOptions = defaultRemoveOptions) : void {
    function innerRemove(nodes: T[]): T[] {
      const result: T[] = [];
      for (const n of nodes) {
        const children = innerRemove(n.children as T[]);
        if (!equalsCallback(n, toRemove)) {
          const newNode : T = { ...n, children };
          result.push(newNode);
          continue;
        }
        if (options.keepChildren && children.length > 0) {
          result.push(...children);
        }
      }

      return result;
    }

    this._tree = innerRemove(this._tree);
  }

  removeAll(toRemove: T[], equalsCallback: (a: T, b: T) => boolean, options: TreeRemoveOptions = defaultRemoveOptions) : void {
    for (const rmv of toRemove) {
      this.remove(rmv, equalsCallback, options);
    }
  }

  toString(callback: (node: T) => string = (node:T) => node.toString()): string {
    function toStringHelper(indent: number = 0, ...nodes: T[]) : string {
      let result = '';
      for (const n of nodes) {
        result += '  '.repeat(indent) + callback(n) + '\n';
        result += toStringHelper(indent + 2, ...n.children as T[]);
      }
      return result;
    }

    return toStringHelper(0, ...Array.from(this._tree));
  }
}

//// Example usage with SyntaxNode
//const rootNode: SyntaxNode = [> ... <];
//const abstractSyntaxTree = new AbstractTree<SyntaxNode>([rootNode]);
//
//const allNodes = abstractSyntaxTree.flattenAllChildren();
//const filteredNodes = abstractSyntaxTree.filter((node) => node.type === 'Identifier');
//abstractSyntaxTree.removeChild(rootNode);
//
//// Example usage with DocumentSymbol
//const rootSymbol: DocumentSymbol = [> ... <];
//const abstractSymbolTree = new AbstractTree<DocumentSymbol>([rootSymbol]);
//
//const allSymbols = abstractSymbolTree.flattenAllChildren();
//const filteredSymbols = abstractSymbolTree.filter((symbol) => symbol.kind === 'Class');
//abstractSymbolTree.removeChild(rootSymbol);

export function filterTree<T extends TNode>(nodes: T[], callbackfn: (node: T) => boolean): T[] {
  function inner(nodes: T[], callbackfn: (node: T) => boolean) : T[] {
    const result: T[] = [];
    for (const n of nodes) {
      let children: T[] = [];
      if ('children' in n) {
        children = inner(n.children as T[], callbackfn);
      }
      if (callbackfn(n)) {
        result.push(n);
        continue;
      }
      if (children.length > 0) {
        result.push(...children as T[]);
      }
    }
    return result;
  }

  return inner(nodes, callbackfn) as T[];
}
