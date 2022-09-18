export function difference<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  const result = new Set<T>()

  set1.forEach((value: T) => {
    if (!set2.has(value)) result.add(value)
  })

  return result
}

export class DependencyNode {
  public parentUris: Set<string> = new Set()
  public childrenUris: Set<string> = new Set()
}

export class DependencyMap extends Map<string, DependencyNode> {
  public get(uri: string): DependencyNode {
    if (!super.get(uri)) super.set(uri, new DependencyNode())

    return super.get(uri) as DependencyNode
  }

  public update(uri: string, newDependencies: Set<string>): void {
    const oldDependencies = this.get(uri).childrenUris

    difference(oldDependencies, newDependencies).forEach((childUri: string) => {
      this.get(childUri).parentUris.delete(uri)
    })

    newDependencies.forEach((childUri: string) => {
      this.get(childUri).parentUris.add(uri)
    })

    this.get(uri).childrenUris = newDependencies
  }

  public hasParent(
    uri: string,
    parentUri: string,
    visitedUris: Set<string> = new Set(),
  ): boolean {
    if (visitedUris.has(uri)) return false

    const { parentUris } = this.get(uri)

    if (parentUris.has(parentUri)) return true

    visitedUris.add(uri)

    for (const pu of parentUris) {
      if (this.hasParent(pu, parentUri, visitedUris)) return true
    }

    return false
  }

  /**
   * Get entire dependency tree flattened to a set of URIs
   */
  public getAllBreadthFirst(uri: string): Set<string> {
    const result = new Set<string>()
    const queue = [uri]

    result.add(uri)

    while (queue.length) {
      const uri = queue.shift()!

      for (const u of this.get(uri).childrenUris) {
        if (result.has(u)) continue
        result.add(u)
        queue.push(u)
      }
    }

    return result
  }

  /**
   * Get entire dependency tree flattened to a set of URIs
   */
  public getAllDepthFirst(uri: string): Set<string> {
    const result = new Set<string>()
    const stack = [uri]

    while (stack.length) {
      const uri = stack.pop()!

      result.add(uri)

      for (const u of [...this.get(uri).childrenUris].reverse()) {
        if (result.has(u)) continue
        stack.push(u)
      }
    }

    return result
  }

  /**
   * Get document URIs which have access to the given document scope
   */
  public getLinkedUris(queriedUri: string): Set<string> {
    const result = new Set<string>()
    const queue = [queriedUri]

    while (queue.length) {
      const uri = queue.shift()!

      if (result.has(uri)) continue

      queue.push(...this.get(uri).childrenUris)
      queue.push(...this.get(uri).parentUris)

      result.add(uri)
    }

    return result
  }
}
