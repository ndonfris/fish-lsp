
import { setLogger } from './helpers';

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import {
  execEscapedCommand,
  execCmd,
  execCompleteLine,
  execCompleteSpace,
  execCommandDocs,
  execCommandType,
  ExecFishFiles,
  EmbeddedFishResult,
  runEmbeddedFish,
} from '../src/utils/exec';

function hasManPage(name: string): boolean {
  try {
    execSync(`man -w ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasLocalManFile(relativePath: string): boolean {
  return fs.existsSync(path.resolve(__dirname, '..', relativePath));
}

function normalizeManDashes(input: string): string {
  // Normalize common unicode dash/minus glyphs emitted by `man` formatting.
  return input.replace(/[‐‑‒–—−]/g, '-');
}
import { BuiltInList } from '../src/utils/builtins';
import GetType from '../fish_files/get-type.fish';

setLogger();

describe('src/utils/exec.ts tests', () => {
  it('execEscapedCommand', async () => {
    const output = await execEscapedCommand('pwd');
    const check = path.resolve(__dirname, '..');
    // const result = path.resolve(output.toString())
    // console.log("escaped:", output[0], '---', check);
    expect(output[0]!).toEqual(check);
  });

  it('execCmd', async () => {
    const output = await execCmd('pwd');
    const check = path.resolve(__dirname, '..');
    // console.log('execCmd: ', output[0], '---', check);
    expect(output[0]!).toEqual(check);
  });

  it('execCompleteLine', async () => {
    const output = await execCompleteLine('echo -');
    // console.log('line: ', output.length);
    expect(output.length).toEqual(4);
  });

  it('execCompleteSpace', async () => {
    const output = await execCompleteSpace('string ');
    // console.log('line: ', output.length);
    expect(output.length).toEqual(17);
  });

  it('execCommandDocs', async () => {
    const output = await execCommandDocs('end');
    // console.log('docs: ', output.split('\n').length);
    expect(output.split('\n').length).toBeGreaterThan(10);
  });

  it('execCommandDocs for subcommands (e.g. string-split)', async () => {
    const output = await execCommandDocs('string', 'split');
    const type = await execCommandType('string', 'split');
    console.log('execCommandDocs("string-split"):', output.split('\n').slice(0, 5).join('\n'));
    console.log('execCommandType("string-split"):', JSON.stringify(type));
    expect(output).toBeTruthy();
    expect(output).toContain('STRING-SPLIT');
  });

  it.skipIf(!hasLocalManFile('man/fish-lsp.1'))('execCommandDocs does not split hyphenated command names (e.g. fish-lsp)', async () => {
    const output = await execCommandDocs('fish-lsp');
    const type = await execCommandType('fish-lsp');
    const localManOutput = fs.readFileSync(path.resolve(__dirname, '..', 'man/fish-lsp.1'), 'utf8');
    console.log('execCommandDocs("fish-lsp"):', output.split('\n').slice(0, 5).join('\n'));
    console.log('local man/fish-lsp.1:', localManOutput.split('\n').slice(0, 5).join('\n'));
    console.log('execCommandType("fish-lsp"):', JSON.stringify(type));
    expect(output).toBeTruthy();
    expect(normalizeManDashes(localManOutput).toUpperCase()).toContain('FISH-LSP');
    expect(normalizeManDashes(output).toUpperCase()).toContain('FISH-LSP');
  });

  it('execCommandType', async () => {
    const output = await execCommandType('end');
    // console.log('docs: ', output.split('\n').length);
    expect(output).toEqual('builtin');
  });

  describe('ExecFishFiles namespace', () => {
    const expector = {
      pass: ({ stdout, stderr, code }: EmbeddedFishResult) => {
        expect(stdout.toString().length).toBeGreaterThan(0);
        expect(code).toEqual(0);
        expect(stderr.toString().length).toEqual(0);
      },
      fail: ({ stdout, stderr, code }: EmbeddedFishResult) => {
        expect(stdout.toString().length).toEqual(0);
        expect(code).not.toEqual(0);
        expect(stderr.toString().length).toBeGreaterThan(0);
      },
    };

    let timesCalled = 0;
    const _logging = true;
    type PrintDocsParams = EmbeddedFishResult & {
      cmd?: string;
      verbose?: boolean;
    };
    function printDocsStdout(input: PrintDocsParams) {
      const { stdout, stderr, code, verbose, cmd } = input;
      if (!_logging) return;
      if (timesCalled === 0) console.log('-------------------------');
      timesCalled += 1;
      if (cmd) {
        console.log(`Documentation for command: \`${cmd}\``);
      }
      if (verbose) {
        console.log('=== VERBOSE OUTPUT ===');
        console.log('--- stdout ---');
        console.log(stdout);
        console.log('--- stderr ---');
        console.log(stderr);
        console.log('--- code ---');
        console.log(code);
        console.log('-------------------------');
      } else {
        const totalLines = stdout.toString().split('\n').length;
        const firstLines = stdout.toString().split('\n').slice(0, 4).join('\n');
        console.log('--- truncated stdout ---');
        if (totalLines >= 4) {
          console.log([
            firstLines,
            totalLines > 4 ? `+ ...... ${totalLines - 4} more lines.` : '',
          ].join('\n'));
        } else {
          console.log(stdout);
        }
        if (stderr.length > 0) {
          console.log('--- stderr ---');
          console.log(stderr);
        }
        if (code !== null) {
          console.log('--- code ---');
          console.log(code);
        }
        console.log('-------------------------');
      }
    }

    describe('get-docs.fish', () => {
      it('base tests', async () => {
        console.log('Testing ExecFishFiles.getDocs for "echo"...');
        const output = await ExecFishFiles.getDocs('echo');
        printDocsStdout({ ...output, cmd: 'echo' });
        expector.pass(output);

        const bgOutput = await ExecFishFiles.getDocs('bg');
        // console.log('ExecFishFiles getCommandDoc: ', bgOutput.stdout.toString());
        printDocsStdout({ ...bgOutput, cmd: 'bg' });
        expector.pass(bgOutput);

        const testOutput = await ExecFishFiles.getDocs('[');
        // console.log('ExecFishFiles getCommandDoc: ', testOutput.stdout.toString());
        printDocsStdout({ ...testOutput, cmd: '[' });
        expector.pass(testOutput);

        const fkrOutput = await ExecFishFiles.getDocs('fish_key_reader');
        // console.log('ExecFishFiles getCommandDoc: ', fkrOutput.stdout.toString());
        printDocsStdout({ ...fkrOutput, cmd: 'fish_key_reader' });
        expector.pass(fkrOutput);

        const nonExistOutput = await ExecFishFiles.getDocs('nonexistentcommand123');
        printDocsStdout({ ...nonExistOutput, cmd: 'nonexistentcommand123' });
        expector.fail(nonExistOutput);
      });

      it('multiple commands `string match`, `git worktree`', async () => {
        console.log('Testing ExecFishFiles.getDocs for multiple commands (string-match, git-worktree)...');
        const cmds = [
          ['string', 'match'],
          ['git', 'worktree'],
        ];
        for await (const args of cmds) {
          // console.log(`Testing ExecFishFiles.getDocs for \`${args[0]} ${args[1]}\`...`);
          const output = await ExecFishFiles.getDocs(...args);
          // console.log(`ExecFishFiles getCommandDoc for \`${args[0]} ${args.slice(1).join(' ')}\`: `, output.stdout.toString());
          printDocsStdout({ ...output, cmd: `${args[0]} ${args.slice(1).join(' ')}` });
          expector.pass(output);
          expect(output.stdout.toString().length).toBeGreaterThan(0);
        }
      });

      it('builtin', async () => {
        console.log('Testing ExecFishFiles.getDocs for all built-in commands...');
        const badCmds: string[] = [];
        await Promise.all(BuiltInList.map(async (cmd) => {
          const output = await ExecFishFiles.getDocs(cmd);
          printDocsStdout({ ...output, cmd });
          expector.pass(output);
          if (output.stdout.toString().length === 0) badCmds.push(cmd);
        }));
        badCmds.forEach((cmd) => {
          console.error('ExecFishFiles getCommandDoc failed for command: ', cmd);
        });
        expect(badCmds.length).toEqual(0);
      });

      it('functions: __fish_contains_opt, fish_update_completions, fish_config', async () => {
        console.log('Testing ExecFishFiles.getDocs for fish functions(__fish_contains_opt, fish_update_completions, fish_config)...');
        const functionCmds = ['__fish_contains_opt', 'fish_update_completions', 'fish_config'];
        for await (const cmd of functionCmds) {
          const output = await ExecFishFiles.getDocs(cmd);
          // console.log('ExecFishFiles getCommandDoc: ', cmd, '---', 'lines:', output.stdout.toString().split('\n').length);
          printDocsStdout({ ...output, cmd });
          expect(output.stdout.toString().length).toBeGreaterThan(0);
        }
        // console.log(`Testing ExecFishFiles.getDocs for function \`${cmd}\`...`);
      });

      it('commands', async () => {
        console.log('Testing ExecFishFiles.getDocs for fish commands...');
        const out = await ExecFishFiles.getDocs('git');
        // console.log('ExecFishFiles getCommandDoc: ', 'git', '---', out.stdout.toString());
        printDocsStdout({ ...out, cmd: 'git' });
        expector.pass(out);
        expect(out.stdout.toString().split('\n').at(3)!.trim().includes('git - the stupid content tracker')).toBeTruthy();
      });

      describe('edge cases', () => {
        it('empty command', async () => {
          console.log('Testing ExecFishFiles.getDocs for empty command...');
          const output = await ExecFishFiles.getDocs('');
          // console.log('ExecFishFiles getCommandDoc: ', '---', output.stdout.toString());
          printDocsStdout({ ...output, cmd: '', verbose: true });
          expect(output.stdout.toString().length).toEqual(0);
          expector.fail(output);
        });

        it('command with flags', async () => {
          console.log('Testing ExecFishFiles.getDocs for `git --help` command...');
          const output = await ExecFishFiles.getDocs('git', '--help');
          // console.log('ExecFishFiles getCommandDoc: ', '---', output.stdout.toString());
          printDocsStdout({ ...output, cmd: 'git --help' });
          expect(output.stdout.toString().length).toBeGreaterThan(0);
          expect(output.code).toEqual(0);
          expector.pass(output);

          const passingOutput = await ExecFishFiles.getDocs('git', 'status');
          printDocsStdout({ ...passingOutput, cmd: 'git status' });
          expect(passingOutput.stdout.toString().length).toBeGreaterThan(0);
          expect(passingOutput.code).toEqual(0);
          expector.pass(output);
        });

        it('variables as command', async () => {
          console.log('Testing ExecFishFiles.getDocs for `$HOME` command...');
          const output = await ExecFishFiles.getDocs('$HOME');
          // console.log('ExecFishFiles getCommandDoc: ', '---', output.stdout.toString());
          printDocsStdout({ ...output, cmd: '$HOME', verbose: true });
          expect(output.stdout.toString().length).toEqual(0);
          expector.fail(output);
        });
      });
    });
    describe('getType', () => {
      it('basic tests', async () => {
        const commands = ['echo', 'set', 'function', 'for', 'if', 'end', 'cd', 'nonexistentcommand123'];
        for await (const cmd of commands) {
          const output = await ExecFishFiles.getType(cmd);
          printDocsStdout({ ...output, cmd });
          if (cmd !== 'nonexistentcommand123') {
            expect(output.stdout.toString().trim()).toEqual('command');
          } else {
            expect(output.stdout.toString().trim()).toEqual('');
            expect(output.code).toEqual(0);
          }
        }
      });
      it('function command', async () => {
        const functionCmds = ['__fish_contains_opt', 'fish_update_completions', 'fish_config'];
        for await (const cmd of functionCmds) {
          const output = await ExecFishFiles.getType(cmd);
          printDocsStdout({ ...output, cmd });
          expect(output.stdout.toString().trim()).toEqual('file');
          expect(output.code).toEqual(0);
        }
      });

      it('function shadowing external command is still typed as file', async () => {
        const script = [
          'function ls',
          '  command ls $argv',
          'end',
          GetType,
        ].join('\n');
        const output = await runEmbeddedFish(script, ['ls']);
        printDocsStdout({ ...output, cmd: 'ls (shadowed by function)' });
        expect(output.stdout.toString().trim()).toEqual('file');
        expect(output.code).toEqual(0);
      });
    });
  });
});
