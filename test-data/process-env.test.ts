
import { env, EnvManager } from '../src/utils/env-manager';
import { setupProcessEnvExecFile, AutoloadedPathVariables } from '../src/utils/process-env';
import { setLogger } from './helpers';

describe('setting up process-env', () => {
  setLogger();

  beforeEach(async () => {
    env.clear();
    await setupProcessEnvExecFile();
  });

  describe('envManager', () => {
    it('get EMPTY STRING', () => {
      // console.log('EMPTY STR ""', env.get(''));
      expect(env.get('')).toBeUndefined();
      // console.log('EMPTY STR " "', env.get(' '));
      expect(env.get(' ')).toBeUndefined();
      // console.log('EMPTY STR ""', env.getAsArray(''));
      expect(env.getAsArray('')).toEqual([]);
      // console.log('EMPTY STR " "', env.getAsArray(' '));
      expect(env.getAsArray(' ')).toEqual([]);
    });

    it('get(process.env.NODE_ENV)', () => {
      // console.log('NODE_ENV', env.get('NODE_ENV'));
      expect(env.get('NODE_ENV')).toBe('test');
    });

    it('getAsArray(AutloadedPathVariables.all())', () => {
      AutoloadedPathVariables.all().forEach((variable) => {
        // console.log(`${variable}:`, env.getAsArray(variable));
        expect(Array.isArray(env.getAsArray(variable))).toBeTruthy();
      });
    });

    it('getAsArray(process.env)', () => {
      Object.keys(process.env).forEach((variable) => {
        // console.log(`${variable}:`, env.getAsArray(variable));
        expect(Array.isArray(env.getAsArray(variable))).toBeTruthy();
      });
    });

    it('getAsArray(fish_lsp_all_indexed_paths)', () => {
      env.set('fish_lsp_all_indexed_paths', '/usr/share/fish /usr/local/share/fish $HOME/.config/fish');
      // console.log('fish_lsp_all_indexed_paths', env.getAsArray('fish_lsp_all_indexed_paths'));
      expect(env.getAsArray('fish_lsp_all_indexed_paths').length).toEqual(3);
    });

    it('getProcessEnv()', () => {
      // console.log('process.env', env.getProcessEnv());
      expect(env.processEnv).toEqual(process.env);
    });
  });

  describe('keys', () => {
    it('process.env', () => {
      // console.log(env.getProcessEnvKeys().length)
      expect(env.getProcessEnvKeys().length).toBeGreaterThan(0);
      expect(env.getProcessEnvKeys().length).toBeGreaterThanOrEqual(6);
    });

    it('envManager', () => {
      // console.log(env.getAutoloadedKeys().length)
      expect(env.getAutoloadedKeys().length).toBeGreaterThan(0);
      expect(env.getAutoloadedKeys().length).toBeGreaterThanOrEqual(14);
    });

    it('allKeys', () => {
      expect(env.keys.length).toEqual(20);
      // env.keys.forEach((key, idx) => {
      //   console.log(`${idx+1}. ${key}:`, env.getAsArray(key).slice(0, 2).join(', ').slice(0, 50));
      // })
      // console.log('autoloaded', env.getAutoloadedKeys().length);
      // env.getAutoloadedKeys().forEach((key, idx) => {
      //   console.log(`${idx+1}. ${key}:`, env.getAsArray(key).slice(0, 2).join(', ').slice(0, 50));
      // })
      // console.log('process.env', env.getProcessEnvKeys().length);
      // env.getProcessEnvKeys().forEach((key, idx) => {
      //   console.log(`${idx+1}. ${key}:`, env.getAsArray(key).slice(0, 2).join(', ').slice(0, 50));
      // })
      // console.log('all', env.keys.length);
      // env.keys.forEach((key, idx) => {
      //   console.log(`${idx+1}. ${key}:`, env.getAsArray(key).slice(0, 2).join(', ').slice(0, 50));
      // })
      // console.log('entries')
      // env.entries.forEach(([key, value], idx) => {
      //   console.log(`${idx+1}. ${key}: ${value?.slice(0, 50) || ''}`);
      // })
      expect(env.keys.length).toEqual(env.processEnvKeys.size + env.autoloadedKeys.size);
    });
  });

  describe('has/includes', () => {
    it('has(process.env)', () => {
      expect(env.has('NODE_ENV')).toBeTruthy();
    });

    it('has(autoloaded)', () => {
      expect(env.has('fish_user_paths')).toBeTruthy();
    });

    it('isAutoloaded', () => {
      expect(env.isAutoloaded('fish_user_paths')).toBeTruthy();
    });

    it('isProcessEnv', () => {
      expect(env.isProcessEnv('NODE_ENV')).toBeTruthy();
    });
    it('isArray', () => {
      expect(env.isArray('fish_user_paths')).toBeTruthy();
    });

    it('entry get type', () => {
      env.entries.forEach(([key, value]) => {
        if (env.isAutoloaded(key)) {
          expect(Array.isArray(env.getAsArray(key))).toBeTruthy();
          if (EnvManager.isArrayValue(value)) {
            expect(env.isArray(key)).toBeTruthy();
          }
        } else if (env.isProcessEnv(key)) {
          expect(typeof value).toBe('string');
        } else {
          fail();
        }
      });
    });
  });

  describe('token parser', () => {
    it('parsePathVariable', () => {
      const value = '/path/bin:/path/to/bin:/usr/share/bin';
      const result = env.parser().parsePathVariable(value);
      expect(result).toEqual(['/path/bin', '/path/to/bin', '/usr/share/bin']);
    });

    it('parseSpaceSeparatedWithQuotes', () => {
      const value = 'one two three "four five" six "seven eight"';
      const result = env.parser().parseSpaceSeparatedWithQuotes(value);
      expect(result).toEqual(['one', 'two', 'three', 'four five', 'six', 'seven eight']);
    });

    it('getAtIndex', () => {
      const value = '/path/bin:/path/to/bin:/usr/share/bin';
      const result = env.parser().parsePathVariable(value);
      expect(env.parser().getAtIndex(result, 1)).toEqual('/path/bin');
      expect(env.parser().getAtIndex(result, 2)).toEqual('/path/to/bin');
      expect(env.parser().getAtIndex(result, 3)).toEqual('/usr/share/bin');
      expect(env.parser().getAtIndex(result, 4)).toBeUndefined();
      expect(env.parser().getAtIndex(result, 0)).toBeUndefined();
    });

    describe('parsing tokens `var_{1,2,3,4,5}`', () => {
      // Test examples
      const examples = [
        {
          name: 'var_1',
          input: "'index 1' 'index 2' 'index 3'",
          output: ['index 1', 'index 2', 'index 3'],
        },
        {
          name: 'var_2',
          input: '/path/bin:/path/to/bin:/usr/share/bin',
          output: ['/path/bin', '/path/to/bin', '/usr/share/bin'],
        },
        {
          name: 'var_3',
          input: 'a b c d e f',
          output: ['a', 'b', 'c', 'd', 'e', 'f'],
        },
        {
          name: 'var_4',
          input: "'a b c' d 'e f'",
          output: ['a b c', 'd', 'e f'],
        },
        {
          name: 'var_5',
          input: 'a',
          output: ['a'],
        },
      ];

      examples.forEach(({ name, input, output }) => {
        it(`parse ${name}`, () => {
          const parsed = env.parser().parse(input);
          expect(env.has(name)).toBeFalsy();
          // console.log(parsed);
          expect(parsed).toEqual(output);
        });
      });
    });

    describe('append/prepend', () => {
      it('append existing', () => {
        const key = 'PATH';
        const value = '/path/bin:/path/to/bin:/usr/share/bin';
        env.set(key, value);
        env.append(key, '/usr/bin');
        expect(env.getAsArray(key)).toEqual(['/path/bin', '/path/to/bin', '/usr/share/bin', '/usr/bin']);
      });

      it('prepend existing', () => {
        const key = 'PATH';
        const value = '/path/bin:/path/to/bin:/usr/share/bin';
        env.set(key, value);
        env.prepend(key, '/usr/bin:/bin');
        expect(env.getAsArray(key)).toEqual(['/usr/bin', '/bin', '/path/bin', '/path/to/bin', '/usr/share/bin']);
      });

      it('append empty', () => {
        const key = 'prevdir';
        const value = '';
        env.set(key, value);
        env.append(key, '/usr/bin');
        expect(env.getAsArray(key)).toEqual(['/usr/bin']);
        expect(env.get(key)).toEqual('/usr/bin');
      });

      it('prepend empty', () => {
        const key = 'dirprev';
        const value = '';
        env.set(key, value);
        env.prepend(key, '/usr/bin /bin');
        expect(env.getAsArray(key)).toEqual(['/usr/bin', '/bin']);
        expect(env.get(key)).toEqual('/usr/bin /bin');
      });
    });
  });
});

// Usage:
// const env = EnvManager.getInstance();
// env.set('MY_VAR', 'value');
// const value = env.get('MY_VAR');
// const childEnv = env.getForChildProcess(); // For child_process usage
