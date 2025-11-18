import { logger } from '../logger';
import { AutoloadedEnvKeys, setupProcessEnvExecFile } from './process-env';

/**
 * Parses fish shell variable strings into arrays based on their format
 */
class FishVariableParser {
  /**
   * Main parse method that detects and handles different formats
   */
  static parse(value: string): string[] {
    if (!value || value.trim() === '') return [];

    // Check if this is a PATH-like variable (contains colons)
    if (value.includes(':') && !value.includes(' ')) {
      return this.parsePathVariable(value);
    }

    // Otherwise parse as a space-separated variable possibly with quotes
    return this.parseSpaceSeparatedWithQuotes(value);
  }

  /**
   * Parse colon-separated path variables
   * Example: "/path/bin:/path/to/bin:/usr/share/bin"
   */
  static parsePathVariable(value: string): string[] {
    return value.split(':').filter(Boolean);
  }

  /**
   * Parse space-separated values with respect for quotes
   * Handles both single and double quotes
   */
  static parseSpaceSeparatedWithQuotes(value: string): string[] {
    const result: string[] = [];
    let currentToken = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let wasEscaped = false;

    for (let i = 0; i < value.length; i++) {
      const char = value[i];

      // Handle escape character
      if (char === '\\' && !wasEscaped) {
        wasEscaped = true;
        continue;
      }

      // Handle quotes
      if (char === "'" && !wasEscaped && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (char === '"' && !wasEscaped && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      // Handle spaces - only split on spaces outside of quotes
      if (char === ' ' && !inSingleQuote && !inDoubleQuote && !wasEscaped) {
        if (currentToken) {
          result.push(currentToken);
          currentToken = '';
        }
        continue;
      }

      // Add the character to the current token
      currentToken += char;
      wasEscaped = false;
    }

    // Add the last token if there is one
    if (currentToken) {
      result.push(currentToken);
    }

    return result;
  }

  /**
   * Special method for indexing fish arrays (1-based indexing)
   */
  static getAtIndex(array: string[], index: number): string | undefined {
    // Fish uses 1-based indexing
    if (index < 1) return undefined;
    return array[index - 1];
  }

  static tokenSeparator(value: string): ':' | ' ' {
    if (value.includes(':') && !value.includes(' ')) {
      return ':';
    }
    return ' ';
  }
}

export class EnvManager {
  private static instance: EnvManager;
  private envStore: Record<string, string | undefined> = {};
  /**
   * Keys that are present in the process.env
   */
  public processEnvKeys: Set<string> = new Set(Object.keys(process.env));
  /**
   * Keys that are autoloaded by fish shell and have non-empty values
   */
  public autoloadedKeys: Set<string> = new Set();
  private allKeys: Set<string> = new Set();
  /**
   * Tracks whether autoloaded fish variables have been initialized
   */
  private initialized: boolean = false;

  private constructor() {
    // Add all keys to the set
    this.setAllKeys();
    // Clone initial environment
    Object.assign(this.envStore, process.env);
  }

  private setAllKeys(): void {
    this.allKeys = new Set([
      ...this.getProcessEnvKeys(),
      ...this.getAutoloadedKeys(),
    ]);
  }

  public static getInstance(): EnvManager {
    if (!EnvManager.instance) {
      EnvManager.instance = new EnvManager();
    }
    return EnvManager.instance;
  }

  /**
   * Check if autoloaded fish variables have been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mark autoloaded fish variables as initialized
   */
  public markInitialized(): void {
    this.initialized = true;
  }

  /**
   * Mark autoloaded fish variables as not initialized
   */
  public markUninitialized(): void {
    this.initialized = false;
  }

  public has(key: string): boolean {
    return this.allKeys.has(key);
  }

  public set(key: string, value: undefined | string): void {
    this.allKeys.add(key);
    this.envStore[key] = value;
  }

  /**
   * Sets an autoloaded fish variable and registers it in autoloadedKeys.
   * Only adds to autoloadedKeys if the value is non-empty.
   */
  public setAutoloaded(key: string, value: string): void {
    if (!AutoloadedEnvKeys.isVariableName(key)) {
      logger.error(`Key "${key}" is not a recognized autoloaded fish variable name.`);
      return;
    }
    if (value && value.trim() !== '') {
      this.set(key, value);
      this.autoloadedKeys.add(key);
    }
  }

  public get(key: string): string | undefined {
    return this.envStore[key];
  }

  public getAsArray(key: string): string[] {
    const value = this.envStore[key];
    return FishVariableParser.parse(value || '');
  }

  public getFirstValueInArray(key: string): string | undefined {
    return this.getAsArray(key).at(0);
  }

  public static isArrayValue(value: string): boolean {
    return FishVariableParser.parse(value).length > 1;
  }

  public isArray(key: string): boolean {
    return this.getAsArray(key).length > 1;
  }

  public isAutoloaded(key: string): boolean {
    return this.autoloadedKeys.has(key);
  }

  public isProcessEnv(key: string): boolean {
    return this.processEnvKeys.has(key);
  }

  public append(key: string, value: string): void {
    const existingValue = this.getAsArray(key);
    const untokenizedValue = this.get(key);
    if (this.isArray(key)) {
      const tokenSeparator = FishVariableParser.tokenSeparator(untokenizedValue || '');
      existingValue.push(value);
      this.envStore[key] = existingValue.join(tokenSeparator);
    } else {
      this.envStore[key] = `${untokenizedValue || ''} ${value}`.trim();
    }
  }

  public prepend(key: string, value: string) {
    const existingValue = this.getAsArray(key);
    const untokenizedValue = this.get(key);
    if (this.isArray(key)) {
      const tokenSeparator = FishVariableParser.tokenSeparator(untokenizedValue || '');
      existingValue.unshift(value);
      this.envStore[key] = existingValue.join(tokenSeparator);
    } else {
      this.envStore[key] = `${value} ${untokenizedValue || ''}`.trim();
    }
  }

  public get processEnv(): NodeJS.ProcessEnv {
    return process.env;
  }

  public get autoloadedFishVariables(): Record<string, string[]> {
    const autoloadedFishVariables: Record<string, string[]> = {};
    this.getAutoloadedKeys().forEach((variable) => {
      autoloadedFishVariables[variable] = this.getAsArray(variable);
    });
    return autoloadedFishVariables;
  }

  get keys(): string[] {
    return Array.from(this.allKeys);
  }

  public getAutoloadedKeys(): string[] {
    return Array.from(this.autoloadedKeys);
  }

  public getProcessEnvKeys(): string[] {
    return Array.from(this.processEnvKeys);
  }

  public findAutolaodedKey(key: string): string | undefined {
    if (key.startsWith('$')) {
      key = key.slice(1);
    }
    return this.getAutoloadedKeys().find((k) => k === key || this.getAsArray(k).includes(key));
  }

  get values() {
    const values: string[][] = [];
    for (const key in this.envStore) {
      values.push(this.getAsArray(key));
    }
    return values;
  }

  get entries(): [string, string][] {
    return this.keys.map((key) => {
      const value = this.get(key);
      return [key, value || ''];
    });
  }

  public parser() {
    return FishVariableParser;
  }

  private clear(): void {
    for (const key in this.envStore) {
      delete this.envStore[key];
    }
    this.autoloadedKeys.clear();
    this.markUninitialized();
    this.setAllKeys();
    Object.assign(this.envStore, process.env);
  }

  /**
   * For initializing and resetting the environment manager to a clean state during
   * tests.
   *
   * @example
   * ```typescript
   * beforeEach(async () => {
   *     await env.reset();
   * })
   * ```
   */
  public async reset(logging: boolean = false): Promise<void> {
    logger.setSilent(!logging);
    env.clear();
    await setupProcessEnvExecFile();
    logger.setSilent(false);
  }
}

export const env = EnvManager.getInstance();

