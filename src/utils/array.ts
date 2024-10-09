declare global {
  interface Array<T> {
    /**
     * @param callbackfn - A function that is called on every item throughout the entire
     * collection and returns a boolean value that must not be true for any item
     * @returns {boolean} True if none of the items in the collection satisfy the condition
     */
    none(callbackfn: (value: T, index: number, array: T[]) => boolean): boolean;
    /**
     * Remove duplicates from an array of items based on the key returned by the callback function
     * @param callbackfn - A function that is called on every item throughout the entire
     * collection, and returns a key that is used to determine uniqueness
     * @returns {T[]} An array of unique items
     */
    unique<U>(callbackfn: (value: T, index: number, array: T[]) => U): T[];
    /**
   * Filters the array to keep only unique elements based on the callback function's result.
   * If multiple elements produce the same result from the callback, only the first occurrence is kept.
   * @param callbackfn A function that accepts up to three arguments. The filterUnique method calls
   * the callbackfn function one time for each element in the array to compute uniqueness.
   * @returns A new array containing only the unique elements based on the callback function's result.
   */
    // filterUnique<U>(callbackfn: (value: T, index: number, array: T[]) => U): T[];
    /**
     * Filters the array to keep only the last unique elements based on the callback function's result,
     * while preserving the original order of the items.
     * If multiple elements produce the same result from the callback, only the last occurrence is kept.
     * @param callbackfn A function that accepts up to three arguments. The filterLastUnique method calls
     * the callbackfn function one time for each element in the array to compute uniqueness.
     * @returns A new array containing only the last unique elements based on the callback function's result,
     * in their original order.
     */
    // filterLastUnique<U>(callbackfn: (value: T, index: number, array: T[]) => U): T[];
    /**
     *
     * ```typescript
     * for (const [index, item] of ['a', 'b', 'c'].enumerate()) {
     *   console.log(index, item);
     * }
     * ```
     * ---
     * Enumerate the array of items transforming [...items] to [[0, item0], [1, item1], ...]
     * @returns {Array<[number, T]>} An array of tuples containing the index and the item
     */
    enumerate(): [number, T][];

    /**
     * Skip items in the array while the condition is true
     *
     * For example, `[0, 0, 0, 1, 2].skipWhile(x => x === 0) => [1, 2]`
     *
     * @param callbackfn - A function that is called on every item throughout the entire, until
     * the condition is false
     * @returns {T[]} An array of items that are after the first sequence of items that
     * satisfy the callbackfn
     */
    skipWhile(callbackfn: (value: T, index: number, array: T[]) => boolean): T[];
    /**
     * Collect items in the array while the condition is true
     *
     * For example, `[1, 2, 3, 4, 5].collectWhile(x => x < 4) => [1, 2, 3]`
     *
     * @param callbackfn - A function that is called on every item throughout the entire, until
     * the condition is false
     * @returns {T[]} An array of items that are before the first sequence of items that
     * satisfy the callbackfn
     */
    collectWhile(callbackfn: (value: T, index: number, array: T[]) => boolean): T[];
    /**
     * Log all the items in the array
     *
     * For example, `[[0,1], [1, 2], [2, 3], [3, 4], [4, 5]].logAll(x => x[0])`
     */
    logAll(callbackfn: (value: T, index: number, array: T[]) => void): void;

    /**
     * Get the first item in the array
     * @returns {T | undefined} The first item in the array or undefined if the array is empty
     */
    first(): T | undefined;
    /**
     * Get the last item in the array
     * @returns {T | undefined} The last item in the array or undefined if the array is empty
     */
    last(): T | undefined;
    /**
     * Check if the array is empty
     * @returns {boolean} True if the array is empty
     */
    isEmpty(): boolean;
  }
}
/**
 * @param callbackfn - A function that is called on every item throughout the entire
 * collection and returns a boolean value that must not be true for any item
 * @returns {boolean} - True if none of the items in the collection satisfy the condition
 */
global.Array.prototype.none = function <T>(this: T[], callbackfn: (value: T, index: number, array: T[]) => boolean): boolean {
  return !this.some(callbackfn);
};

/**
 * Remove duplicates from an array of items based on the key returned by the callback function
 * @param callbackfn - A function that is called on every item throughout the entire
 * collection, and returns a key that is used to determine uniqueness
 * @returns {T[]} - An array of unique items
 */
global.Array.prototype.unique = function <T, U>(this: T[], callbackfn: (value: T, index: number, array: T[]) => U): T[] {
  const seen = new Set<U>();
  return this.filter((value, index, array) => {
    const key = callbackfn(value, index, array);
    return seen.has(key) ? false : (seen.add(key), true);
  });
};

/**
 * Filters the array to keep only unique elements based on the callback function's result.
 * If multiple elements produce the same result from the callback, only the first occurrence is kept.
 * @param callbackfn A function that accepts up to three arguments. The filterUnique method calls
 * the callbackfn function one time for each element in the array to compute uniqueness.
 * @returns A new array containing only the unique elements based on the callback function's result.
 */
// global.Array.prototype.filterUnique = function <T, U>(this: T[], callbackfn: (value: T, index: number, array: T[]) => U): T[] {
//   const seen = new Set<U>();
//   return this.filter((value, index, array) => {
//     const key = callbackfn(value, index, array);
//     if (!key) {
//       return false;
//     } else if (seen.has(key)) {
//       return false;
//     } else {
//       seen.add(key);
//       return true;
//     }
//   });
//   // const seen = new Set<U>();
//   // return this.filter((value, index, array) => {
//   //   const key = callbackfn(value, index, array);
//   //   if (seen.has(key)) {
//   //     return false;
//   //   } else {
//   //     seen.add(key);
//   //     return true;
//   //   }
//   // });
// };
//
// // Array.prototype.filterLastUnique = function<T, U>(this: T[], callbackfn: (value: T, index: number, array: T[]) => U): T[] {
// Array.prototype.filterLastUnique = function <T, U>(this: T[], callbackfn: (value: T, index: number, array: T[]) => U): T[] {
//   const seen = new Map<T, number>();
//   const result: T[] = [];
//
//   // First pass: identify the last occurrence of each unique item
//   for (let i = this.length - 1; i >= 0; i--) {
//     const item = this[i] as T;
//     if (callbackfn(item, i, this) && !seen.has(item)) {
//       seen.set(item, i);
//     }
//   }
//
//   // Second pass: collect items in original order
//   this.forEach((item, index) => {
//     if (seen.get(item) === index) {
//       result.push(item);
//     }
//   });
//
//   return result.toReversed();
//   // const seen = new Map<U, number>();
//   // const result: T[] = [];
//   //
//   // // First pass: identify the last index of each unique item
//   // this.forEach((value, index, array) => {
//   //   const key = callbackfn(value, index, array);
//   //   seen.set(key, index);
//   // });
//   //
//   // // Second pass: build the result array
//   // this.forEach((value, index, array) => {
//   //   const key = callbackfn(value, index, array);
//   //   if (seen.get(key) === index) {
//   //     result.push(value);
//   //   }
//   // });
//   //
//   // return result;
// };
// const seen = new Map<U, number>();
// const result: T[] = [];
//
// // First pass: record the last index of each unique item
// for (let i = this.length - 1; i >= 0; i--) {
//   const key = callbackfn(this[i]!, i, this);
//   if (key && !seen.has(key)) {
//     seen.set(key, i);
//   }
// }
//
// // Second pass: collect items in original order
// this.forEach((value, index) => {
//   const key = callbackfn(value, index, this);
//   if (seen.get(key) === index) {
//     result.push(value);
//   }
// });
//
// return result;
// };
//   const seen = new Map<U, number>();
//   const result: T[] = [];
//
//   let i = 0;
//   // First pass: record the last index of each unique item
//   for (const item of this) {
//     const key = callbackfn(item, i, this);
//     if (key) {
//       seen.set(key, i);
//     }
//     i++;
//   }
//
//   // Second pass: collect items in original order, but only if they're the last occurrence
//   for (const key of Array.from(seen.keys())) {
//     // const key = callbackfn(item, i, this);
//     if (key && seen.has(key)) {
//       const lastIdx = seen.get(key) as keyof typeof this;
//       result.push(this[lastIdx] as T);
//     }
//   }
//   return result;
// };

/**
 * Enumerate the array of items transforming [...items] to [[0, item0], [1, item1], ...]
 *
 * ```typescript
 * for (const [index, item] of ['a', 'b', 'c'].enumerate()) {
 *   console.log(index, item);
 * }
 * ```
 *
 * @returns {Array<[number, T]>} - An array of tuples containing the index and the item
 */
global.Array.prototype.enumerate = function <T>(this: T[]): [number, T][] {
  return this.map((value, index) => [index, value]);
};

// Implement unique
// Array.prototype.unique = function<T>(this: T[], callbackfn?: (value: T) => any): T[] {
//   if (callbackfn) {
//     const seen = new Set();
//     return this.filter(item => {
//       const key = callbackfn(item);
//       return seen.has(key) ? false : seen.add(key);
//     });
//   } else {
//     return Array.from(new Set(this));
//   }
// };

// // Implement skip
// Array.prototype.skip = function<T>(this: T[], n: number): T[] {
//   return this.slice(n);
// };
//
// // Implement skipWhile
// Array.prototype.skipWhile = function<T>(this: T[], callbackfn: (value: T | undefined, index: number, array: T[]) => boolean): T[] {
//   let index = 0;
//   while (index < this.length && callbackfn(this[index], index, this)) {
//     index++;
//   }
//   return this.slice(index);
// };

/**
 * Skip items in the array while the condition is true
 *
 * For example, `[0, 0, 0, 1, 2].skipWhile(x => x === 0) => [1, 2]`
 *
 * @param callbackfn - A function that is called on every item throughout the entire, until
 * the condition is false
 * @returns {T[]} - An array of items that are after the first sequence of items that
 * satisfy the callbackfn
 */
global.Array.prototype.skipWhile = function <T>(this: T[], callbackfn: (value: T, index: number, array: T[]) => boolean): T[] {
  let i = 0;
  while (i < this.length && !!this[i] && callbackfn(this[i] as T, i, this)) {
    i++;
  }
  return this.slice(i);
};

/**
 * Collect items in the array while the condition is true
 *
 * For example, `[1, 2, 3, 4, 5].collectWhile(x => x < 4) => [1, 2, 3]`
 *
 * @param callbackfn - A function that is called on every item throughout the entire, until
 * the condition is false
 * @returns {T[]} - An array of items that are before the first sequence of items that
 * satisfy the callbackfn
 */
global.Array.prototype.collectWhile = function <T>(this: T[], callbackfn: (value: T, index: number, array: T[]) => boolean): T[] {
  const result: T[] = [];
  for (let i = 0; i < this.length; i++) {
    const item = this[i];
    if (item === undefined) break;
    if (!callbackfn(item, i, this)) {
      break;
    }
    result.push(item);
  }
  return result;
};

/**
 * Log all the items in the array
 *
 * For example, `[1, 2, 3, 4, 5].logAll(x => console.log(x))`
 */
global.Array.prototype.logAll = function <T>(this: T[], callbackfn: (value: T, index: number, array: T[]) => void): void {
  this.forEach((value, index, array) => {
    // eslint-disable-next-line no-console
    console.log(callbackfn(value, index, array));
  });
};

/**
 * Get the first item in the array
 */
global.Array.prototype.first = function <T>(this: T[]): T | undefined {
  return this[0];
};

/**
 * Get the last item in the array
 */
global.Array.prototype.last = function <T>(this: T[]): T | undefined {
  return this[this.length - 1];
};

/**
 * Check if the array is empty
 */
global.Array.prototype.isEmpty = function <T>(this: T[]): boolean {
  return this.length === 0;
};

// Prevent the new properties from appearing in a for...in loop
Object.defineProperty(global.Array.prototype, 'none', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'unique', { enumerable: false });
// Object.defineProperty(global.Array.prototype, 'filterUnique', { enumerable: false });
// Object.defineProperty(global.Array.prototype, 'filterLastUnique', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'enumerate', { enumerable: false });

Object.defineProperty(global.Array.prototype, 'skipWhile', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'collectWhile', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'logAll', { enumerable: false });

Object.defineProperty(global.Array.prototype, 'first', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'last', { enumerable: false });
Object.defineProperty(global.Array.prototype, 'isEmpty', { enumerable: false });

export { };

// This line is necessary to make the file a module and avoid global scope pollution
// export global;