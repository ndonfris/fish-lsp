export function getChildNodes<T extends { children: T[]; }>(root: T): T[] {
  const queue: T[] = [root];
  const result: T[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (current) {
      result.push(current);
      queue.unshift(...current.children);
    }
  }
  return result;
}

export function getNamedChildNodes<T extends { children: T[]; isNamed?: boolean; }>(root: T): T[] {
  const queue: T[] = [root];
  const result: T[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (current) {
      if (current.isNamed) {
        result.push(current);
      }
      queue.unshift(...current.children);
    }
  }
  return result;
}

export function findChildNodes<T extends { children: T[]; }>(root: T, predicate: (node: T) => boolean): T[] {
  const queue: T[] = [root];
  const result: T[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (current) {
      if (predicate(current)) {
        result.push(current);
      }
      queue.unshift(...current.children);
    }
  }
  return result;
}

/**
 * BFS
 */
export function* nodesGen<T extends { children: T[]; }>(...roots: T[]): Generator<T> {
  const stack: T[] = Array.from(roots);
  while (stack.length > 0) {
    const node = stack.shift();
    if (node) {
      yield node;
      stack.unshift(...node.children);
    }
  }
}

export function* DFSNodesIter<T extends { children: T[]; }>(...roots: T[]): IterableIterator<T> {
  const stack: T[] = roots;
  while (stack.length > 0) {
    const node = stack.shift();
    if (node) {
      yield node;
      stack.unshift(...node.children);
    }
  }
}

export function* BFSNodesIter<T extends { children: T[]; }>(...roots: T[]): Generator<T> {
  const queue = roots;
  while (queue.length > 0) {
    const node = queue.shift();
    if (node) {
      yield node;
      queue.push(...node.children);
    }
  }
}

export function* reverseBFSNodesIter<T extends { children: T[]; parent?: T; }>(...startNodes: T[]): Generator<T> {
  const queue: T[] = startNodes;
  const visited: Set<T> = new Set();

  while (queue.length > 0) {
    const currentNode = queue.shift();
    if (currentNode) {
      // Check if the current node is a definition
      // Note: isDefinition function needs to be defined or replaced with appropriate logic
      yield currentNode;

      visited.add(currentNode);

      if (currentNode.parent && !visited.has(currentNode.parent)) {
        queue.push(currentNode.parent);
      }
    }
  }
}

// export function* reverseBFSInScope<T extends HasChildren<T> & { parent?: T, startIndex?: number }>(startNode: T): Generator<T> {
//   const queue: T[] = [startNode];
//   const visited: Set<T> = new Set();
//
//   while (queue.length > 0) {
//     const currentNode = queue.shift();
//     if (currentNode) {
//       // Note: These functions need to be defined or replaced with appropriate logic
//       if (isVariableDefinitionName(currentNode) && currentNode.startIndex != null && startNode.startIndex != null && currentNode.startIndex < startNode.startIndex) {
//         yield currentNode;
//       }
//
//       if (isFunctionDefinitionName(currentNode)) {
//         yield currentNode;
//       }
//
//       visited.add(currentNode);
//
//       if (currentNode.parent && !visited.has(currentNode.parent)) {
//         queue.push(currentNode.parent);
//       }
//
//       const siblings = currentNode.parent ? currentNode.parent.children : [];
//       for (const sibling of siblings) {
//         if (sibling !== currentNode && !visited.has(sibling)) {
//           queue.push(sibling);
//         }
//       }
//     }
//   }
// }
