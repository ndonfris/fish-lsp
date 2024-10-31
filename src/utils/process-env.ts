// import { NodeJS.ProcessEnv } from 'process';
import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const autoloadedFishVariableNames = [
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
  'fish_function_dir',
  'fish_completion_dir',
  'fish_user_paths',
] as const;

export type AutoloadedFishVariableNames = typeof autoloadedFishVariableNames[number];

export async function setupProcessEnvExecFile() {
  try {
    const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
    const { stdout } = await execFileAsync('fish', [file]);

    stdout.split('\n').forEach(line => {
      const [variable, value]: [AutoloadedFishVariableNames, string] = line.split('\t') as [AutoloadedFishVariableNames, string];
      if (value && value.trim()) {
        process.env[variable] = value.trim();
      }
    });
  } catch (error) {
    process.stderr.write('[ERROR] retrieving autoloaded fish env variables failure\n');
  }
  return autoloadedFishVariableNames;
}

// export namespace processEnv {
//   const countChar = (str: string, char: string): number => {
//     return str.split(char).length - 1;
//   };
//
//   export function get(variable: keyof typeof process.env | AutoloadedFishVariableNames): string | string[] {
//     const value = process.env[variable];
//     if (value && countChar(value, ':') > 1 && !value.includes(' ')) {
//       return value.split(':');
//     }
//     return process.env[variable] || '';
//   }
// }