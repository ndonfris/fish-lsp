/**
 * ___Example types for flattening include:___ \`SyntaxNode\`, \`FishDocumentSymbol\`, and \`DocumentSymbol\`
 *
 * ---
 *
 * ```typescript
 * flattenNested(...[
 *   {name: 'foo', kind: 'function', children: [
 *       {name: 'a', kind: 'variable', children: []},
 *       {name: 'b', kind: 'variable', children: []},
 *       {name: 'c', kind: 'variable', children: []},
 *   ]},
 *   {name: 'bar', kind: 'function', children: []},
 *   {name: 'baz', kind: 'function', children: []},
 * ]); // [foo, a, b, c, bar, baz]
 * ```
 *
 * ---
 *
 * __Flattens__ a __nested array__ of objects with a __\`children\` property__.
 *
 * @param roots an _array_ of objects with a `children` property.
 *
 * @returns a _flat_ array of all objects and their children.
 */
export function flattenNested<T extends { children?: T[]; }>(...roots: T[]): T[] {
  const result: T[] = [];
  let index = 0;

  result.push(...roots);

  while (index < result.length) {
    const current = result[index++];
    if (current?.children) result.push(...current.children);
  }

  return result;
}
