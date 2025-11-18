import { join } from 'path';
import { existsSync } from 'fs';
import { PrebuiltDocumentationMap } from './snippets';
import { md } from './markdown-builder';
import { env } from './env-manager';
import { execEmbeddedFishFile } from './exec';

/**
 * All autoloaded fish path variables that can be retrieved from fish shell.
 *
 * Values for these variables are retrieved by executing the fish script
 * `fish_files/get-fish-autoloaded-paths.fish`, which outputs their values
 * in the format:
 *
 * ```fish
 * variable_name\tvalue_1:value_2:value_3:value_4:...:value_n\n
 * other_variable_name\tvalue_1:value_2:...:value_n\n
 * ```
 */
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

// Keys which are set prior to executing fish_files/get-fish-autoloaded-paths.fish
// with a fallback value in case the script execution fails to provide them.
const fallbackEnvKeys: AutoloadedFishVariableName[] = [
  '__fish_bin_dir',
  '__fish_config_dir',
  '__fish_data_dir',
  '__fish_help_dir',
  '__fish_sysconf_dir',
  '__fish_user_data_dir',
  '__fish_vendor_completionsdirs',
  '__fish_vendor_confdirs',
  '__fish_vendor_functionsdirs',
  'fish_function_path',
  'fish_complete_path',
];

export type AutoloadedFishVariableName = typeof autoloadedFishVariableNames[number];

export namespace AutoloadedEnvKeys {
  /**
   * getter util for autoloaded fish variables, returns array of strings that
   */
  export function isVariableName(name?: string): name is AutoloadedFishVariableName {
    if (!name) return false;
    return autoloadedFishVariableNames.includes(name as AutoloadedFishVariableName);
  }

  export function isFallbackKey(name?: string): name is AutoloadedFishVariableName {
    if (!name) return false;
    return fallbackEnvKeys.includes(name as AutoloadedFishVariableName);
  }

}

export async function setupProcessEnvExecFile() {
  if (env.isInitialized()) return autoloadedFishVariableNames;
  setupFallbackProcessEnv();
  try {
    const result = await execEmbeddedFishFile('get-fish-autoloaded-paths.fish');

    result.stdout.trim().split('\n').forEach(line => {
      const [variable, ...value] = line.split('\t');
      const storeValue = value.join('\t').trim();
      if (!AutoloadedEnvKeys.isFallbackKey(variable)) return;
      env.setAutoloaded(variable, storeValue);
    });
  } catch (error) {
    // Silently fall back to default paths - logging would write to stdout
    // before the LSP connection is established, corrupting the protocol
  }
  env.markInitialized();
  return autoloadedFishVariableNames;
}

export function setupFallbackProcessEnv() {
  // Set basic fallback values when fish script execution fails
  const homeDir = process.env.HOME || '/tmp';
  const fishBin = process.env.FISH_BIN || '/usr/bin/fish';
  const fishPrefix = fishBin.replace(/\/bin\/fish$/, '');

  env.setAutoloaded('__fish_bin_dir', `${fishPrefix}/bin`);
  env.setAutoloaded('__fish_config_dir', `${homeDir}/.config/fish`);
  env.setAutoloaded('__fish_data_dir', `${fishPrefix}/share/fish`);
  env.setAutoloaded('__fish_help_dir', `${fishPrefix}/share/doc/fish`);
  env.setAutoloaded('__fish_sysconf_dir', `${fishPrefix}/etc/fish`);
  env.setAutoloaded('__fish_user_data_dir', `${homeDir}/.local/share/fish`);
  env.setAutoloaded('__fish_vendor_completionsdirs', `${fishPrefix}/share/fish/vendor_completions.d`);
  env.setAutoloaded('__fish_vendor_confdirs', `${fishPrefix}/share/fish/vendor_conf.d`);
  env.setAutoloaded('__fish_vendor_functionsdirs', `${fishPrefix}/share/fish/vendor_functions.d`);

  const functionPaths = [
    `${env.get('__fish_config_dir')}/functions`,
    `${env.get('__fish_vendor_functionsdirs')}`,
    `${env.get('__fish_data_dir')}/functions`,
  ];
  env.setAutoloaded('fish_function_path', functionPaths.join(':'));

  const completePaths = [
    `${env.get('__fish_config_dir')}/completions`,
    `${env.get('__fish_vendor_completionsdirs')}`,
    `${env.get('__fish_data_dir')}/completions`,
  ];
  env.setAutoloaded('fish_complete_path', completePaths.join(':'));
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
