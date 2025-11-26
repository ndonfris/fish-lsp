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

// string prototype extensions
declare global {
  interface String {
    /**
     * Split string by newlines into an array
     * @returns Array of lines
     */
    splitNewlines(): string[];

    /**
     * Split string by newlines and trim each line
     * @returns Array of trimmed lines
     */
    splitNewlinesTrimmed(): string[];
  }
}

if (!String.prototype.splitNewlines) {
  String.prototype.splitNewlines = function(this: string): string[] {
    return this.split('\n');
  };
}

if (!String.prototype.splitNewlinesTrimmed) {
  String.prototype.splitNewlinesTrimmed = function(this: string): string[] {
    return this.split('\n').map(s => s.trim());
  };
}

// Export empty object to make this a module
export {};
