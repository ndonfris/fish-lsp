import { setLogger } from './helpers';
import { escapeCmd, shellComplete } from '../src/utils/completion/shell';

describe('check completions', () => {
  setLogger();

  describe('test escaping input', () => {
    it("echo '", () => {
      const cmd = 'echo \'';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });

    it('echo "', async () => {
      const cmd = 'echo \"';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });

    it('echo $', async () => {
      const cmd = 'echo $';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });

    it('echo $', async () => {
      const cmd = 'echo $';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });
    it('echo \\"$', async () => {
      const cmd = 'echo \"$';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });

    it('echo \\\\n$', async () => {
      const cmd = 'echo \\\n$';
      const escapedCmd = escapeCmd(cmd);
      // console.log({ cmd, escapedCmd });
      expect(escapedCmd.length).toBeGreaterThan(cmd.length);
    });
  });

  describe('fish-lsp', () => {
    it('fish-lsp --', async () => {
      const completions = await shellComplete('fish-lsp --');
      const output = [
        ['--help', 'Show help information'],
        ['--help-all', 'Show all help information'],
        ['--help-man', 'Show raw manpage'],
        ['--help-short', 'Show short help information'],
        ['--version', 'Show lsp version'],
      ];
      expect(completions).toEqual(output);
    });

    it('fish-lsp ', async () => {
      const completions = await shellComplete('fish-lsp ');
      const items = completions.map(([first, rest]) => first);
      expect(items).toContain('start');
      expect(items).toContain('complete');
    });

    it('fish-lsp start -', async () => {
      const output = await shellComplete('fish-lsp start -');
      const expected = [
        ['--disable', ''],
        ['--dump', 'dump output and stop server'],
        ['--enable', ''],
      ];
      for (const [name, detail] of output) {
        expect(expected).toContainEqual([name, detail]);
      }
    });

    it('fish-lsp start --enable ', async () => {
      const output = await shellComplete('fish-lsp start --enable ');
      expect(output.length).toBeGreaterThan(6);
      // console.log(output)
    });
  });

  describe('builtins', () => {
    it('pwd -', async () => {
      const completions = await shellComplete('pwd -');
      // console.log(completions);
      const expected = [
        ['-h', 'Display help and exit'],
        ['-L', 'Print working directory without resolving symlinks'],
        ['-P', 'Print working directory with symlinks resolved'],
        ['--help', 'Display help and exit'],
        ['--logical', 'Print working directory without resolving symlinks'],
        ['--physical', 'Print working directory with symlinks resolved'],
      ];
      for (const item of expected) {
        expect(completions).toContainEqual(item);
      }
    });

    it('function ', async () => {
      const completions = await shellComplete('function ');
      expect(completions.length).toBeGreaterThanOrEqual(61); // 61 is the number of builtins
    });

    it('function foo -', async () => {
      const completions = await shellComplete('function foo -');
      const expected = [
        ['-a', 'Specify named arguments'],
        ['-d', 'Set function description'],
        ['-e', 'Make the function a generic event handler'],
        ['-j', 'Make the function a job exit event handler'],
        ['-p', 'Make the function a process exit event handler'],
        ['-S', 'Do not shadow variable scope of calling function'],
        ['-s', 'Make the function a signal event handler'],
        ['-V', 'Snapshot and define local variable'],
        ['-v', 'Make the function a variable update event handler'],
        ['-w', 'Inherit completions from the given command'],
        ['--argument-names', 'Specify named arguments'],
        ['--description', 'Set function description'],
        ['--inherit-variable', 'Snapshot and define local variable'],
        [
          '--no-scope-shadowing',
          'Do not shadow variable scope of calling function',
        ],
        ['--on-event', 'Make the function a generic event handler'],
        ['--on-job-exit', 'Make the function a job exit event handler'],
        [
          '--on-process-exit',
          'Make the function a process exit event handler',
        ],
        ['--on-signal', 'Make the function a signal event handler'],
        [
          '--on-variable',
          'Make the function a variable update event handler',
        ],
        ['--wraps', 'Inherit completions from the given command'],
      ];
      for (const item of expected) {
        expect(completions).toContainEqual(item);
      }
    });

    it('ab', async () => {
      const completions = await shellComplete('ab');
      expect(completions.map(item => item[0])).toContain('abbr');
    });

    it('__fish', async () => {
      const completions = await shellComplete('__fish');
      // console.log(completions);
      expect(completions.length).toBeGreaterThan(61);
    });

    it('set -', async () => {
      const completions = await shellComplete('set -');
      const expected = [
        ['-a', 'Append value to a list'],
        ['-e', 'Erase variable'],
        ['-f', 'Make variable function-scoped'],
        ['-g', 'Make variable scope global'],
        ['-h', 'Display help and exit'],
        ['-L', 'Do not truncate long lines'],
        ['-l', 'Make variable scope local'],
        ['-n', 'List the names of the variables, but not their value'],
        ['-p', 'Prepend value to a list'],
        ['-q', 'Test if variable is defined'],
        ['-S', 'Show variable'],
        ['-U', 'Share variable persistently across sessions'],
        ['-u', 'Do not export variable to subprocess'],
        ['-x', 'Export variable to subprocess'],
        ['--append', 'Append value to a list'],
        ['--erase', 'Erase variable'],
        ['--export', 'Export variable to subprocess'],
        ['--function', 'Make variable function-scoped'],
        ['--global', 'Make variable scope global'],
        ['--help', 'Display help and exit'],
        ['--local', 'Make variable scope local'],
        ['--long', 'Do not truncate long lines'],
        ['--names', 'List the names of the variables, but not their value'],
        ['--path', 'Make variable as a path variable'],
        ['--prepend', 'Prepend value to a list'],
        ['--query', 'Test if variable is defined'],
        ['--show', 'Show variable'],
        ['--unexport', 'Do not export variable to subprocess'],
        ['--universal', 'Share variable persistently across sessions'],
        ['--unpath', 'Make variable not as a path variable'],
      ];
      // console.log(completions);
      for (const item of expected) {
        expect(completions).toContainEqual(item);
      }
    });

    it('set -q ', async () => {
      const completions = await shellComplete('set -q ');
      expect(completions.length).toBeGreaterThanOrEqual(1);
    });

    it('complete -c _cmd -', async () => {
      const completions = await shellComplete('complete -c _cmd -');
      const expected = [
        ['-a', 'Space-separated list of possible arguments'],
        [
          '-C',
          'Print completions for a commandline specified as a parameter',
        ],
        ['-c', 'Command to add completion to'],
        ['-d', 'Description of completion'],
        ['-e', 'Remove completion'],
        ['-F', 'Always use file completion'],
        ['-f', "Don't use file completion"],
        ['-h', 'Display help and exit'],
        ['-k', 'Keep order of arguments instead of sorting alphabetically'],
        ['-l', 'GNU-style long option to complete'],
        ['-n', 'Completion only used if command has zero exit status'],
        ['-o', 'Old style long option to complete'],
        ['-p', 'Path to add completion to'],
        ['-r', 'Require parameter'],
        ['-s', 'POSIX-style short option to complete'],
        ['-w', 'Inherit completions from specified command'],
        ['-x', "Require parameter and don't use file completion"],
        ['--arguments', 'Space-separated list of possible arguments'],
        ['--command', 'Command to add completion to'],
        [
          '--condition',
          'Completion only used if command has zero exit status',
        ],
        ['--description', 'Description of completion'],
        [
          '--do-complete',
          'Print completions for a commandline specified as a parameter',
        ],
        ['--erase', 'Remove completion'],
        ['--exclusive', "Require parameter and don't use file completion"],
        ['--force-files', 'Always use file completion'],
        ['--help', 'Display help and exit'],
        [
          '--keep-order',
          'Keep order of arguments instead of sorting alphabetically',
        ],
        ['--long-option', 'GNU-style long option to complete'],
        ['--no-files', "Don't use file completion"],
        ['--old-option', 'Old style long option to complete'],
        ['--path', 'Path to add completion to'],
        ['--require-parameter', 'Require parameter'],
        ['--short-option', 'POSIX-style short option to complete'],
        ['--wraps', 'Inherit completions from specified command'],
      ];
      for (const item of expected) {
        expect(completions).toContainEqual(item);
      }
    });
  });

  describe('commands', () => {
    it("''(EMPTY INPUT)", async () => {
      const completions = await shellComplete('');
      // console.log(completions.slice(0, 10));
      expect(completions.length).toBeGreaterThan(61);
    });

    it('echo -', async () => {
      const completions = await shellComplete('echo -');
      const expected = [
        ['-E', 'Disable backslash escapes'],
        ['-e', 'Enable backslash escapes'],
        ['-n', 'Do not output a newline'],
        ['-s', 'Do not separate arguments with spaces'],
      ];
      // console.log(completions);
      for (const item of expected) {
        expect(completions).toContainEqual(item);
      }
    });

    it('echo "$', async () => {
      const completions = await shellComplete('echo "$');
      // console.log(completions);
      expect(completions.length).toBeGreaterThan(1);
      const items = completions.map(item => item[0]);
      items.forEach(name => {
        expect(name.startsWith('$')).toBeTruthy();
      });
      // expect(items.filter(i => i.includes('$PWD'))).toBeTruthy();
      expect(items).toContain('$PWD');
      expect(items).toContain('$HOME');
      expect(items).toContain('$fish_pid');
    });

    it("echo \'$", async () => {
      const completions = await shellComplete("echo '$");
      expect(completions.length).toBe(0);
    });

    it('echo \\\\n$', async () => {
      const completions = await shellComplete('echo \\\n$');
      const items = completions.map(item => item[0]);
      expect(items.length).toBeGreaterThan(0);
      expect(items).toContain('$PWD');
      expect(items).toContain('$HOME');
      expect(items).toContain('$fish_pid');
    });

    it('echo "$PATH$', async () => {
      const completions = await shellComplete('echo "$HOME$');
      const items = completions.map(item => item[0]);
      expect(items.length).toBeGreaterThan(0);
      expect(items).toContain('$HOME$PWD');
      expect(items).toContain('$HOME$HOME');
      expect(items).toContain('$HOME$fish_pid');
    });
  });

  describe('commands w/ subcommands', () => {
    it.only('string ', async () => {
      const completions = await shellComplete('string ');
      expect(completions.length).toBeGreaterThanOrEqual(17);
      // console.log(completions);
    });

    it.only('git ', async () => {
      const completions = await shellComplete('git ');
      expect(completions.length).toBeGreaterThan(3);
      // console.log(completions);
    });
  });
});
