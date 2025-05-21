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

/**
 * Generator function that iterates over a nested structure of objects with a \`children\` property
 * in the same DFS order used by the `flattenNested` function.
 */
export function* iterateNested<T extends { children?: T[]; }>(...roots: T[]): Generator<T> {
  // Create a queue starting with the root nodes
  const queue: T[] = [...roots];

  // Process nodes in the queue one by one
  while (queue.length > 0) {
    // Get the next node from the front of the queue
    const current = queue.shift()!;

    // Yield the current node
    yield current;

    // Add its children to the end of the queue (if any)
    if (current?.children) {
      queue.push(...current.children);
    }
  }
}
