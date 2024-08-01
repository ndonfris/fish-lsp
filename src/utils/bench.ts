import { exec, execFile } from 'child_process';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type FileEntry = [word: string, details: string];

type ParsedFile = FileEntry[];

function parseFile(fileContent: string) {
    fileContent.split('\n').map(line => {
        const [word, details] = line.split('\t');
        return [word, details ?? ''] as FileEntry;
    }).forEach(([variable, details]) => {
      process.env[variable] = details
    })
}

export const bench = async () => {
  console.time('env');
  const regularEnv = process.env.HOME;
  console.log({regularEnv});
  console.timeEnd('env');

  // const { stdout } = await execAsync(`fish -NP -c 'echo $__fish_config_dir'`);
  const test2 = async () => {

    console.time('fish');

    // const autoloadedFishVariableNames = [
    //   '__fish_added_user_paths',
    //   '__fish_bin_dir',
    //   '__fish_config_dir',
    //   '__fish_data_dir',
    //   '__fish_help_dir',
    //   '__fish_sysconf_dir',
    //   '__fish_user_data_dir',
    //   '__fish_vendor_completionsdirs',
    //   '__fish_vendor_confdirs',
    //   '__fish_vendor_functionsdirs',
    //   'fish_function_path',
    //   'fish_complete_path',
    //   'fish_user_paths'
    // ] as const;

    let res: [string, string][] = []
    try {
      const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
      const { stdout } = await execFileAsync('fish', [file]);
      // console.log(stdout);

      parseFile(stdout.toString())
    } catch (error) {
      console.error('Error retrieving fish variables:', error);
    }

    console.timeEnd('fish');
    return res;
  }
  await test2()
  console.log(process.env['fish_function_path']);
}

bench()