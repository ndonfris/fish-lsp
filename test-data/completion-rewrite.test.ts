import { setLogger } from './helpers';
import { completionFile, execSubshellCompletions } from '../src/utils/completion/executor';
import { SyncFileHelper } from '../src/utils/fileOperations';

setLogger();

describe('completion rewrite test suite', () => {

  it('test completionFile exists', () => {
    // console.log(completionFile);
    expect(SyncFileHelper.exists(completionFile)).toBeTruthy();
  });

  it('test options: "echo -"', async () => {
    const output = (await execSubshellCompletions('echo -')).split('\n');
    // console.log(output);
    const expected: string[] = [
      "-E\tDisable backlash escapes",
      "-e\tEnable backslash escapes",
      "-n\tDo not output a newline",
      "-s\tDo not separate arguments with spaces"
    ];
    for (const result of expected) {
      expect(output.filter(line => line === result)).toBeTruthy();
    }
  });

  it('test commands/functions', async () => {
    const output = (await execSubshellCompletions('')).split('\n');
    // console.log(output);
    expect(output.length).toBeGreaterThan(1);
  });

  it('test variables', async () => {
    const output = (await execSubshellCompletions('$')).split('\n');
    // console.log(output);
    expect(output.length).toBeGreaterThan(1);
  });

  it('test multiline input 1: \'function foo \\\\n--\'', async () => {
    const input = [ 'function foo \\', '    --' ].join('\n');
    const expected: string[] = [
      '--argument-names\tSpecify named arguments',
      '--description\tSet function description',
      '--inherit-variable\tSnapshot and define local variable',
      '--no-scope-shadowing\tDo not shadow variable scope of calling function',
      '--on-event\tMake the function a generic event handler',
      '--on-job-exit\tMake the function a job exit event handler',
      '--on-process-exit\tMake the function a process exit event handler',
      '--on-signal\tMake the function a signal event handler',
      '--on-variable\tMake the function a variable update event handler',
      '--wraps\tInherit completions from the given command'
    ];

    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    for (const result of expected) {
      expect(output.filter(line => line === result)).toBeTruthy();
    }
  });


  it('test needs escaping 1: \'echo "$\'', async () => {
    const input: string = 'echo "$';
    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    expect(output.length).toBeGreaterThan(1);
  });


  it('test needs escaping 2: \'command ls\\necho "$\'', async () => {
    const input: string = [ 'command ls', 'echo "$' ].join('\n');
    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    expect(output.length).toBeGreaterThan(1);
  });

  it('test needs escaping 3: \'while true\\necho \\"\$\'', async () => {
    const input: string = [ 'while true', 'echo \\"\$' ].join('\n');
    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    expect(output.length).toBeGreaterThan(1);
  });

  it('test needs escaping 4: \'echo "$(\'', async () => {
    const input: string = 'echo "$(';
    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    expect(output.length).toBeGreaterThan(1);
  });

  it('test subcommand 1: \'string collec\'', async () => {
    const input: string = 'string collec';
    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    expect(output).toContain('collect');
  });

  it('test subcommand 2: \'string collect -\'', async () => {
    const input: string = 'string collect -';
    const expected: string[] = [
      '-a\tAlways print empty argument',
      '-h\tDisplay help and exit',
      "-N\tDon't trim trailing newlines",
      '--allow-empty\tAlways print empty argument',
      '--help\tDisplay help and exit',
      "--no-trim-newlines\tDon't trim trailing newlines"
    ];

    const output = (await execSubshellCompletions(input)).split('\n');
    // console.log(output);

    for (const result of expected) {
      expect(output.filter(line => line === result)).toBeTruthy();
    }
  });
});