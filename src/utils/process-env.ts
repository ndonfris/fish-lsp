import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import { PrebuiltDocumentationMap } from './snippets';
import { md } from './markdown-builder';

export const _processEnv = { ...process.env };

const execFileAsync = promisify(execFile);

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

export async function setupProcessEnvExecFile() {
  try {
    const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
    const { stdout } = await execFileAsync('fish', [file]);

    stdout.split('\n').forEach(line => {
      const [variable, value]: [AutoloadedFishVariableName, string] = line.split('\t') as [AutoloadedFishVariableName, string];
      if (value && value.trim()) {
        process.env[variable] = value.trim();
      }
    });
  } catch (error) {
    process.stderr.write('[ERROR] retrieving autoloaded fish env variables failure\n');
  }
  return autoloadedFishVariableNames;
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
    const value = process.env[variable];
    if (value && value.trim()) {
      return value.split(':');
    }
    return [];
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
    process.env[variable] = updatedValues;
    return updatedValues;
  }

  /**
   * for debugging purposes, returns un-split value of autoloaded fish variable
   */
  export function read(variable: AutoloadedFishVariableName): string {
    return process.env[variable] || '';
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
}

// export namespace processEnv {
//   export function get(str: string): string[] | string | undefined {
//     if (AutoloadedPathVariables.includes(str)) {
//       return AutoloadedPathVariables.get(str);
//     }
//     return process.env[str];
//
//   }
// }
