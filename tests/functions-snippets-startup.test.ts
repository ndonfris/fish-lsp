
import { setLogger } from './helpers';
import { ExtendedJson, PrebuiltDocumentationMap } from '../src/utils/snippets';
import { Analyzer, analyzer } from '../src/analyze';
import { flattenNested } from '../src/utils/flatten';
import { SyncFileHelper } from '../src/utils/file-operations';
import { convertStringToOption, Option, OptionParseResult } from '../src/parsing/options';
import { env } from '../src/utils/env-manager';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { execEmbeddedFishFile } from '../src/utils/exec';
import { logger } from '../src/logger';
import { FunctionOptions } from '../src/parsing/function';

describe('snippets/*.json functions.json', () => {
  setLogger();
  let funcs: ExtendedJson[] = [];

  beforeEach(async () => {
    await Analyzer.initialize();
    await env.reset();
    funcs = PrebuiltDocumentationMap.getByType('function');
  });

  describe('singleton `env` tests', () => {
    it('should have autoloaded fish variables', () => {
      const autoloadedKeys = env.getAutoloadedKeys();
      expect(autoloadedKeys.length).toBeGreaterThan(0);
    });

    it('env.entries', async () => {
      expect(env.entries.length).toBeGreaterThan(0);
    });

    it('functions.json `Obj.file` resolution', () => {
      funcs.forEach((func) => {
        logger.log({
          name: func.name,
          file: func.file,
          expanded: SyncFileHelper.expandEnvVars(func.file || ''),
          // raw: {...func}
        });
      });
    });

    // How to convert flag to use `Option` class from `src/parsing/options.ts`?
    // We have access to `FunctionOptions` in `src/parsing/function.ts`
    // We likely need to write a small function to convert flag strings to `Option` instances
    // This may require parsing the flag strings to extract names, descriptions, etc.
    it('{}.flags usage', () => {
      funcs.forEach((func) => {
        if (!func.flags) return;
        const opts: OptionParseResult[] = [];
        func.flags.forEach((flag) => {
          // const [flagOpt, ...flagValue] = flag.split(' '); // Get the flag part before any description
          // const value = flagValue.join(' ');
          // const opt = FunctionOptions.find(o => o.getAllFlags().includes(flagOpt!))
          const result = convertStringToOption(flag, FunctionOptions);
          if (result) opts.push(result);
          // if (opt) {
          //   if (opt.withValue)
          //   opts.push([opt, value]); // Store option and description parts
          // }
        });
        logger.log({
          name: func.name,
          description: func.description,
          path: SyncFileHelper.expandEnvVars(func.file || ''),
          flags: func.flags,
          opts,
        });
      });
    });
  });

  describe('using snippets', () => {
    it('should have functions loaded from snippets', () => {
      console.log(env.get('__fish_data_dir'));
      // PrebuiltDocumentationMap.getByType('function').forEach((func) => {
      //   expect(func.name).toBeDefined();
      //   console.log(func)
      // })
    });

    it('func.names', () => {
      const functionNames = funcs.map(f => f.name);
      expect(functionNames.length).toBeGreaterThan(0);
      console.log('Function Names:', functionNames);
    });

    it('func.descriptions', () => {
      funcs.forEach((func) => {
        expect(func.description).toBeDefined();
        console.log(`Function: ${func.name}, Description: ${func.description}`);
      });
    });
  });

  // describe.skip('env variables', () => {
  //   it('should have FISH_HOME defined', () => {
  //     const fishHome = env.get('HOME');
  //     console.log('HOME:', fishHome);
  //   });
  //
  //   it('__fish_data_dir', () => {
  //     const dataDir = env.get('__fish_data_dir');
  //     env.getAutoloadedKeys().forEach((key) => {
  //       console.log('Autoloaded Key:', key);
  //       const value = env.get(key);
  //       console.log(`Value for ${key}:`, value);
  //     });
  //
  //     (env.autoloadedFishVariables['__fish_data_dir'] || []).forEach((dir) => {
  //       console.log('__fish_data_dir entry:', dir);
  //     });
  //     console.log('__fish_data_dir:', dataDir);
  //   });
  // });
  //
  // describe.skip('functions-snippets-startup', () => {
  //   it('should have valid function snippets', () => {
  //     funcs.forEach((func) => {
  //       expect(func.name).toBeDefined();
  //       // console.log(`Function: ${func.name}`)
  //     });
  //   });
  //
  //
  //
  //   it('function reveal definition', () => {
  //     const test_func = '__fish_contains_opt';
  //     const find_func = funcs.find(f => f.name === test_func);
  //     expect(find_func).toBeDefined();
  //     if (find_func) {
  //       console.log({
  //         name: find_func.name,
  //         description: find_func.description,
  //         file: find_func.file,
  //         options: find_func.flags,
  //         entire: {
  //           ...find_func
  //         }
  //       });
  //       const cached = analyzer.analyzePath(find_func.file!);
  //       const loadedFunc = SyncFileHelper.loadDocumentSync(SyncFileHelper.expandEnvVars(find_func.file!));
  //
  //       console.log({
  //         cached: {
  //           path: cached?.document.path,
  //           functions: flattenNested(...cached?.documentSymbols || []).filter(s => s.isFunction()).map(f => f.name),
  //           variables: flattenNested(...cached?.documentSymbols || []).filter(s => s.isVariable()).map(f => f.name),
  //           doc: {
  //             uri: cached?.document.uri,
  //             text: cached?.document.getText(),
  //             lines: cached?.document.lineCount,
  //           }
  //         },
  //         loadedFunc: {
  //           uri: loadedFunc?.uri,
  //           text: loadedFunc?.getText(),
  //           lines: loadedFunc?.lineCount,
  //         }
  //       });
  //     }
  //
  //   });
  // });
});
