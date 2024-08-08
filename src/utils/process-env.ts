import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function setupProcessEnvExecFile() {
  const autoloadedFishVariableNames = [
    '__fish_added_user_paths',
    '__fish_bin_dir',
    '__fish_config_dir',
    '__fish_data_dir',
    '__fish_help_dir',
    '__fish_initialized',
    '__fish_sysconf_dir',
    '__fish_user_data_dir',
    '__fish_vendor_completionsdirs',
    '__fish_vendor_confdirs',
    '__fish_vendor_functionsdirs',
    'fish_function_dir',
    'fish_completion_dir',
    'fish_user_paths',
  ] as const;

  try {
    const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
    const { stdout } = await execFileAsync('fish', [file]);

    stdout.split('\n').forEach(line => {
      const [variable, value]: [ string, string ] = line.split('\t') as [ string, string ];
      if (value && value.trim()) {
        process.env[variable] = value.trim();
      }
    });
  } catch (error) {
    process.stderr.write('[ERROR] retrieving autoloaded fish env variables failure\n');
  }
  return autoloadedFishVariableNames;
}
