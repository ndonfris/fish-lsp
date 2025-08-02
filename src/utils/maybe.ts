/**
 * Optional/Maybe monad for null-safe operations and functional composition
 *
 * Provides a way to safely chain operations that might return null/undefined
 * without explicit null checking at each step.
 *
 * @example
 * ```typescript
 * // Instead of:
 * const parent = node.parent;
 * if (!parent) return false;
 * const condition = parent.childForFieldName('condition');
 * return condition?.equals(node) || false;
 *
 * // Use:
 * return Maybe.of(node.parent)
 *   .flatMap(p => Maybe.of(p.childForFieldName('condition')))
 *   .equals(node);
 * ```
 */
export class Maybe<T> {
  constructor(private value: T | null | undefined) {}

  /**
   * Create a Maybe from a potentially null/undefined value
   */
  static of<T>(value: T | null | undefined): Maybe<T> {
    return new Maybe(value);
  }

  /**
   * Create an empty Maybe
   */
  static none<T>(): Maybe<T> {
    return new Maybe<T>(null);
  }

  /**
   * Transform the value if present
   */
  map<U>(fn: (value: T) => U | null | undefined): Maybe<U> {
    return this.value ? Maybe.of(fn(this.value)) : Maybe.none<U>();
  }

  /**
   * Chain Maybe operations (flatMap/bind)
   */
  flatMap<U>(fn: (value: T) => Maybe<U>): Maybe<U> {
    return this.value ? fn(this.value) : Maybe.none<U>();
  }

  /**
   * Filter the value based on a predicate
   */
  filter(predicate: (value: T) => boolean): Maybe<T> {
    return !!this.value && predicate(this.value) ? this : Maybe.none<T>();
  }

  /**
   * Get the value or return a default
   */
  getOrElse(defaultValue: T): T;
  getOrElse<U>(defaultValue: U): T | U;
  getOrElse<U>(defaultValue: T | U): T | U {
    return this.value ? this.value : defaultValue;
  }

  /**
   * Check if the Maybe contains a value
   */
  exists(): boolean {
    return !!this.value;
  }

  /**
   * Check if the contained value equals another value (using .equals method if available)
   */
  equals(other: T): boolean {
    if (!this.value) return false;
    if (typeof this.value === 'object' && 'equals' in this.value && typeof this.value.equals === 'function') {
      return (this.value as any).equals(other);
    }
    return this.value === other;
  }

  /**
   * Execute a side effect if the value exists
   */
  ifPresent(action: (value: T) => void): Maybe<T> {
    if (this.value) {
      action(this.value);
    }
    return this;
  }

  /**
   * Get the raw value (use with caution)
   */
  get(): T | null | undefined {
    return this.value;
  }
}
