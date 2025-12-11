import path from 'path';
import { Config } from '../config';
import { AutoloadedPathVariables } from './process-env';
import fs from 'fs';

export function allPossibleAutoloadedFunctionPaths(functionName: string): string[] {
  const files: string[] = [];
  const file = `${functionName}.fish`;
  env.getAsArray('__fish_user_data_dir').forEach(p => {
    files.push(path.join(p, 'functions', file));
  });
  env.getAsArray('__fish_data_dir').forEach(p => {
    files.push(path.join(p, 'functions', file));
  });
  env.getAsArray('__fish_sysconfdir').forEach(p => {
    files.push(path.join(p, 'functions', file));
  });
  env.getAsArray('__fish_sysconf_dir').forEach(p => {
    files.push(path.join(p, 'functions', file));
  });
  env.getAsArray('__fish_vendor_functionsdirs').forEach(p => {
    files.push(path.join(p, file));
  });
  env.getAsArray('__fish_added_user_paths').forEach(p => {
    files.push(path.join(p, 'functions', file));
    files.push(path.join(p, file));
  });
  env.getAsArray('fish_function_path').forEach(p => {
    files.push(path.join(p, file));
  });
  env.getAsArray('__fish_config_dir').forEach(p => {
    files.push(path.join(p, 'functions', file));
  });
  return files;
}

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
   * Keys that are autoloaded by fish shell
   */
  public autoloadedKeys: Set<string> = new Set(AutoloadedPathVariables.all());
  private allKeys: Set<string> = new Set();

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

  public has(key: string): boolean {
    return this.allKeys.has(key);
  }

  public set(key: string, value: undefined | string): void {
    this.allKeys.add(key);
    this.envStore[key] = value;
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

  public getAsTypedArray(key: string): Config.ConfigValueType | undefined {
    if (!this.has(key)) return undefined;
    const arrayValues = this.getAsArray(key);
    if (Array.isArray(arrayValues) && arrayValues.length === 0) return [];
    const isAllNumbers = arrayValues.every((val) => Number.isInteger(Number(val)));
    if (isAllNumbers) {
      return arrayValues.map((val) => Number(val) as number);
    }
    if (arrayValues.length > 0) return arrayValues;

    const singleValue = this.get(key);
    if (singleValue !== undefined) {
      if (Number.isInteger(Number(singleValue))) return Number(singleValue) as number;
      return singleValue;
    }
    return undefined;
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
    AutoloadedPathVariables.all().forEach((variable) => {
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

  public findAutoloadedFunctionPath(functionName: string): string[] {
    const paths: string[] = allPossibleAutoloadedFunctionPaths(functionName);
    const results: string[] = [];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        results.push(p);
      }
    }
    return results;
  }

  /**
   * For testing!
   * Make sure to use `await setupProcessEnvExecFile()` after using this method
   */
  public clear(): void {
    for (const key in this.envStore) {
      delete this.envStore[key];
    }
    this.setAllKeys();
    Object.assign(this.envStore, process.env);
  }
}

export const env = EnvManager.getInstance();

