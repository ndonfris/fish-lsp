// import { execFile } from 'child_process';
// import { promisify } from 'util';
// import path from 'path';
//
// const execFileAsync = promisify(execFile);
//
// //
// export const setupProcessEnvSync = async () => {
//
//   const autoloadedFishVariableNames = [
//     '__fish_added_user_paths',
//     '__fish_bin_dir',
//     '__fish_config_dir',
//     '__fish_data_dir',
//     '__fish_help_dir',
//     '__fish_initialized',
//     '__fish_sysconf_dir',
//     '__fish_user_data_dir',
//     '__fish_vendor_completionsdirs',
//     '__fish_vendor_confdirs',
//     '__fish_vendor_functionsdirs',
//     'fish_function_dir',
//     'fish_completion_dir',
//     'fish_user_paths'
//   ] as const;
//
//
//   // Capture fish-specific variables at startup
//
//
//   let cachedVariables: Record<string, string> = {};
//   let lastCacheTime = 0;
//   const CACHE_DURATION = 60000; // 1 minute
//
//   async function getFishVariables(variables: string[]): Promise<Record<string, string>> {
//     const fishCommand = variables
//       .map(variable => `echo "${variable}=$${variable}"`)
//       .join('; ');
//
//     const { stdout } = await execAsync(`fish -n -c '${fishCommand}'`);
//
//     const result: Record<string, string> = {};
//     stdout.split('\n').forEach(line => {
//       const [ variable, value ] = line.split('=') as [string, string];
//       if (value && value.trim()) {
//         result[ variable ] = value.trim();
//       }
//     });
//
//     return result;
//   }
//
//   const vars = getFishVariables(autoloadedFishVariableNames)
//
//   const result = await Promise.all(vars[Symbol]())
//
//
//   console.log(`Synchronous execution time: ${endTime[ 0 ]}s ${endTime[ 1 ] / 1000000}ms`);
//   return autoloadedFishVariableNames;
// };
// //
// //
// // /**
// //   * call in external location, during initial startup
// //   */
// // setupProcessEnv()
//
// // console.log(process.env['__fish_bin_dir']);
//
// import { exec } from 'child_process';
// import { promisify } from 'util';
//
// const execAsync = promisify(exec);
//
// export const setupProcessEnvAsync = async () => {
//   const startTime = process.hrtime();
//
//   const autoloadedFishVariableNames = [
//     '__fish_added_user_paths',
//     '__fish_bin_dir',
//     '__fish_config_dir',
//     '__fish_data_dir',
//     '__fish_help_dir',
//     '__fish_initialized',
//     '__fish_sysconf_dir',
//     '__fish_user_data_dir',
//     '__fish_vendor_completionsdirs',
//     '__fish_vendor_confdirs',
//     '__fish_vendor_functionsdirs',
//     'fish_function_dir',
//     'fish_completion_dir',
//     'fish_user_paths'
//   ] as const;
//
//   try {
//     // Construct a single fish command to echo all variables
//     const fishCommand = autoloadedFishVariableNames
//       .map(variable => `echo "${variable}=$${variable}"`)
//       .join('; ');
//
//     // Execute the command asynchronously
//     const { stdout } = await execAsync(`fish -c '${fishCommand}'`);
//
//     // Process the output
//     stdout.split('\n').forEach(line => {
//       const [ variable, value ]: [ string, string ] = line.split('=') as [ string, string ];
//       if (value && value.trim()) {
//         process.env[ variable ] = value.trim();
//       }
//     });
//   } catch (error) {
//     console.error('Error retrieving fish variables:', error);
//   }
//
//   const endTime = process.hrtime(startTime);
//   console.log(`Asynchronous execution time: ${endTime[ 0 ]}s ${endTime[ 1 ] / 1000000}ms`);
//   return autoloadedFishVariableNames;
// };
//
import { execFile } from 'child_process';
import path, { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const setupProcessEnvExecFile = async () => {
  // const startTime = process.hrtime();

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
    'fish_user_paths'
  ] as const;

  try {
    const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
    const { stdout } = await execFileAsync('fish', [ file ]);

    stdout.split('\n').forEach(line => {
      const [ variable, value ]: [ string, string ] = line.split('\t') as [ string, string ];
      if (value && value.trim()) {
        process.env[variable] = value.trim();
      }
    });
  } catch (error) {
    console.error('Error retrieving fish variables:', error);
  }

  // const endTime = process.hrtime(startTime);
  // console.log(`ExecFile execution time: ${endTime[ 0 ]}s ${endTime[ 1 ] / 1000000}ms`);

  return autoloadedFishVariableNames;
};

//
//
//
// async function runBenchmark(iterations: number) {
//   console.log(`Running benchmark with ${iterations} iterations for each version`);
//
//   // Benchmark synchronous version
//   // console.log('\nSynchronous version:');
//   // for (let i = 0; i < iterations; i++) {
//   //   setupProcessEnvSync();
//   // }
//
//   // Benchmark asynchronous version
//   console.log('\nAsynchronous version:');
//   for (let i = 0; i < iterations; i++) {
//     await setupProcessEnvAsync();
//   }
//
//
//   // Benchmark execFile version
//   console.log('\nExecFile version:');
//   for (let i = 0; i < iterations; i++) {
//     await setupProcessEnvExecFile();
//   }
// }
//
//
// runBenchmark(20);