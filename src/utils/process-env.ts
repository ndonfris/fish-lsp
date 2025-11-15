import { PrebuiltDocumentationMap } from './snippets';
import { md } from './markdown-builder';
import { env } from './env-manager';
import { execEmbeddedFishFile } from './exec';

export const autoloadedFishVariableNames = [
  '__fish_bin_dir',
  '__fish_config_dir',
  '__fish_data_dir',
  '__fish_help_dir',
  '__fish_initialized',
  '__fish_sysconf_dir',
  '__fish_user_data_dir',
  '__fish_added_user_paths',
  '__fish_vendor_completionsdirs',
  '__fish_vendor_confdirs',
  '__fish_vendor_functionsdirs',
  'fish_function_path',
  'fish_complete_path',
  'fish_user_paths',
] as const;

export type AutoloadedFishVariableName = typeof autoloadedFishVariableNames[number];

export let hasAutoloadedFishVariables = false;

export async function setupProcessEnvExecFile() {
  if (hasAutoloadedFishVariables) return autoloadedFishVariableNames;
  try {
    const result = await execEmbeddedFishFile('get-fish-autoloaded-paths.fish');

    if (result.stderr) {
      process.stderr.write(`[WARN] fish script stderr: ${result.stderr}\n`);
    }

    result.stdout.split('\n').forEach(line => {
      if (line.trim()) {
        const [variable, value]: [AutoloadedFishVariableName, string] = line.split('\t') as [AutoloadedFishVariableName, string];
        if (variable) {
          const storeValue = value ? value.trim() : undefined;
          env.set(variable.trim(), storeValue);
        }
      }
    });
  } catch (error) {
    process.stderr.write(`[ERROR] retrieving autoloaded fish env variables failure: ${error}\n`);
    // Fallback: set basic default paths
    setupFallbackProcessEnv();
  }
  hasAutoloadedFishVariables = true;
  return autoloadedFishVariableNames;
}

function setupFallbackProcessEnv() {
  // Set basic fallback values when fish script execution fails
  const homeDir = process.env.HOME || '/tmp';
  const fishBin = process.env.FISH_BIN || '/usr/bin/fish';
  const fishPrefix = fishBin.replace(/\/bin\/fish$/, '');

  env.set('__fish_bin_dir', `${fishPrefix}/bin`);
  env.set('__fish_config_dir', `${homeDir}/.config/fish`);
  env.set('__fish_data_dir', `${fishPrefix}/share/fish`);
  env.set('__fish_help_dir', `${fishPrefix}/share/doc/fish`);
  env.set('__fish_sysconf_dir', `${fishPrefix}/etc/fish`);
  env.set('__fish_user_data_dir', `${homeDir}/.local/share/fish`);
  env.set('__fish_vendor_completionsdirs', `${fishPrefix}/share/fish/vendor_completions.d`);
  env.set('__fish_vendor_confdirs', `${fishPrefix}/share/fish/vendor_conf.d`);
  env.set('__fish_vendor_functionsdirs', `${fishPrefix}/share/fish/vendor_functions.d`);

  process.stderr.write('[INFO] using fallback fish environment paths\n');
}

export namespace AutoloadedPathVariables {
  /**
   * Type guard for autoloaded fish variables
   */
  export function includes(name: string): name is AutoloadedFishVariableName {
    return autoloadedFishVariableNames.includes(name as AutoloadedFishVariableName);
  }

  /**
   * getter util for autoloaded fish variables, returns array of strings that
   * are separated by `:`, or empty array if variable is not set
   */
  export function get(variable: AutoloadedFishVariableName): string[] {
    return env.getAsArray(variable);
  }

  /*
   * display fish variable in the format that would be shown using
   * ```
   * set --show $variable
   * ```
   */
  export function asShowDocumentation(variable: AutoloadedFishVariableName): string {
    const value = get(variable);

    return [
      `$${variable} set in global scope, unexported, with ${value.length} elements`,
      ...value.map((item, idx) => {
        return `$${variable}[${idx + 1}]:  |${item}|`;
      }),
    ].join('\n');
  }

  /**
   * Probably will not be used, but allows to directly append new values to autoloaded fish variables
   */
  export function update(variable: AutoloadedFishVariableName, ...newValues: string[]): string {
    const values = get(variable);
    const updatedValues = [...values, ...newValues].join(':');
    env.set(variable, updatedValues);
    return updatedValues;
  }

  /**
   * for debugging purposes, returns un-split value of autoloaded fish variable
   */
  export function read(variable: AutoloadedFishVariableName): string {
    return env.get(variable) || '';
  }

  /**
   * returns all autoloaded fish variables
   */
  export function all(): AutoloadedFishVariableName[] {
    return Array.from(autoloadedFishVariableNames);
  }

  /**
   * finds autoloaded fish variable's values by its name
   */
  export function find(key: string): string[] {
    if (includes(key)) {
      return get(key);
    }
    return [];
  }

  /**
   * alias for includes, without type guard
   */
  export function has(key: string): boolean {
    return includes(key);
  }

  export function getHoverDocumentation(variable: string): string {
    if (includes(variable)) {
      const doc = PrebuiltDocumentationMap.getByType('variable').find(({ name }) => name === variable);
      let description = 'Autoloaded fish variable';
      description += doc?.description ? [
        '\n' + md.separator(),
        doc.description,
      ].join('\n') : '';
      return [
        `(${md.italic('variable')}) ${md.bold('$' + variable)}`,
        description,
        md.separator(),
        md.codeBlock('txt', asShowDocumentation(variable)),
      ].join('\n');
    }
    return '';
  }

  /**
   * Find an autoloaded function file by searching fish_function_path directories.
   * Returns the full path to the function file if found, or null if not found.
   *
   * @param functionName - The name of the function to find
   * @returns The absolute path to the function file, or null if not found
   */
  export function findAutoloadedFunctionPath(functionName: string): string | null {
    const { existsSync } = require('fs');
    const { join } = require('path');

    // Get all function paths from fish_function_path
    const functionPaths = get('fish_function_path');

    // Search each directory for the function file
    for (const dir of functionPaths) {
      const functionFilePath = join(dir, `${functionName}.fish`);
      if (existsSync(functionFilePath)) {
        return functionFilePath;
      }
    }

    return null;
  }
}
