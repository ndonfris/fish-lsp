// Polyfills for array methods missing in Node.js 18
// These methods were added in later versions of Node.js/JavaScript

if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function<T>(this: T[]): T[] {
    return [...this].reverse();
  };
}

if (!Array.prototype.toSorted) {
  Array.prototype.toSorted = function<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
    return [...this].sort(compareFn);
  };
}

if (!Array.prototype.toSpliced) {
  Array.prototype.toSpliced = function<T>(this: T[], start: number, deleteCount?: number, ...items: T[]): T[] {
    const result = [...this];
    result.splice(start, deleteCount ?? result.length - start, ...items);
    return result;
  };
}

if (!Array.prototype.with) {
  Array.prototype.with = function<T>(this: T[], index: number, value: T): T[] {
    const result = [...this];
    result[index] = value;
    return result;
  };
}

if (!Array.prototype.at) {
  Array.prototype.at = function<T>(this: T[], index: number): T | undefined {
    const len = this.length;
    const relativeIndex = Math.trunc(index) || 0;
    const k = relativeIndex >= 0 ? relativeIndex : len + relativeIndex;
    return k >= 0 && k < len ? this[k] : undefined;
  };
}

// Export empty object to make this a module
export {};
