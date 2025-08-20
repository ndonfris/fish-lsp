import { accumulateStartupOptions } from '../src/utils/commander-cli-subcommands';
import { validHandlers } from '../src/config';
import { timeServerStartup } from '../src/utils/startup';
import { performHealthCheck } from '../src/utils/health-check';
import { buildFishLspCompletions } from '../src/utils/get-lsp-completions';
import { commandBin } from '../src/cli';
import { spawn } from 'child_process';
import { vi } from 'vitest';

describe('cli tests', () => {
  // Storage for captured output
  let capturedOutput: string[] = [];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  // Setup and teardown
  beforeEach(() => {
    // Clear previous output before each test
    capturedOutput = [];

    // Mock stdout and stderr to capture logger output
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;

    process.stdout.write = vi.fn((str: string) => {
      capturedOutput.push(str);
      return true;
    }) as any;

    process.stderr.write = vi.fn((str: string) => {
      capturedOutput.push(str);
      return true;
    }) as any;
  });

  afterEach(() => {
    // Restore original functions
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  describe('start test', () => {
    describe('accumulate startup options', () => {
      it('fish-lsp start --enable completion \\\n\t\t--disable hover \\\n\t\t--enable diagnostics inlayHint', () => {
        const args = [
          'start',
          '--enable',
          'completion',
          '--disable',
          'hover',
          '--enable',
          'diagnostics',
          'inlayHint',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual(['completion', 'diagnostics', 'inlayHint']);
        expect(disabled).toEqual(['hover']);
        expect(dumpCmd).toEqual(false);
      });

      it('fish-lsp start --dump', () => {
        const args = [
          'start',
          '--dump',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([]);
        expect(disabled).toEqual([]);
        expect(dumpCmd).toEqual(true);
      });

      it('fish-lsp start --disable ALL_HANDLERS', () => {
        const args = [
          'start',
          '--disable',
          ...validHandlers,
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([]);
        expect(disabled).toEqual([...validHandlers]);
        expect(dumpCmd).toEqual(false);
      });

      it('fish-lsp start \\\n\t\t--disable hover inlayHint completion executeCommand \\\n\t\t--stdio', () => {
        const args = [
          'start',
          '--disable',
          'hover',
          'inlayHint',
          'completion',
          'executeCommand',
          '--stdio',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([]);
        expect(disabled).toEqual(['hover', 'inlayHint', 'completion', 'executeCommand']);
        expect(dumpCmd).toEqual(false);
      });

      it('fish-lsp start --enable ALL_HANDLERS \\\n\t\t--socket 2001 \\\n\t\t--disable hover', () => {
        const args = [
          'start',
          '--enable',
          ...validHandlers,
          '--socket',
          '2001',
          '--disable',
          'hover',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([...validHandlers]);
        expect(disabled).toEqual(['hover']);
        expect(dumpCmd).toEqual(false);
      });

      it('fish-lsp start --enable --disable logging complete codeAction', () => {
        const args = [
          'start',
          '--enable',
          '--disable',
          'logging',
          'complete',
          'codeAction',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([]);
        expect(disabled).toEqual(['logging', 'complete', 'codeAction']);
        expect(dumpCmd).toEqual(false);
      });

      it('fish-lsp start --enable ALL_HANDLERS --disable ALL_HANDLERS --dump', () => {
        const args = [
          'start',
          '--enable',
          ...validHandlers,
          '--disable',
          ...validHandlers,
          '--dump',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([...validHandlers]);
        expect(disabled).toEqual([...validHandlers]);
        expect(dumpCmd).toEqual(true);
      });

      it('fish-lsp start --enable ALL_HANDLERS --help --dump', () => {
        const args = [
          'start',
          '--enable',
          ...validHandlers,
          '--help',
          '--dump',
        ];
        const { enabled, disabled, dumpCmd } = accumulateStartupOptions(args);
        expect(enabled).toEqual([...validHandlers]);
        expect(disabled).toEqual([]);
        expect(dumpCmd).toEqual(true);
      });
    });
  });

  describe('info', () => {
    it('fish-lsp info --time-startup', async () => {
      await timeServerStartup({
        timeOnly: true,
      });
      expect(capturedOutput.length).toBeGreaterThan(0);

      // Check that we captured some timing output
      const outputText = capturedOutput.join('');
      expect(outputText).toContain('Server Start Time');
      expect(outputText).toContain('ms');
      expect(outputText.length).toBeGreaterThan(0);
    });

    it('fish-lsp info --check-health', async () => {
      await performHealthCheck();
      expect(capturedOutput.length).toBeGreaterThan(0);

      // Check that we captured some health check output
      const outputText = capturedOutput.join('');
      expect(outputText.length).toBeGreaterThan(0);
    }, 10000); // 10 second timeout
  });

  describe('help', () => {
    it('fish-lsp --help', async () => {
      return new Promise<void>((resolve, reject) => {
        try {
          // Test that src/cli.ts --help outputs help text using Node.js
          const helpProcess = spawn('node', ['-r', 'tsx/cjs', 'src/cli.ts', '--help'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
          });

          let stdout = '';
          let stderr = '';

          helpProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          helpProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          helpProcess.on('error', (error: any) => {
            reject(new Error(`Help process error: ${error.message}`));
          });

          helpProcess.on('close', (code) => {
            // Help command should exit with 0 or 1 (help commands often exit with 0 or 1)
            if (code !== 0 && code !== 1) {
              reject(new Error(`Help command failed with exit code ${code}: ${stderr}`));
              return;
            }

            const output = stdout + stderr;

            // Check that we got some help output
            expect(output.length).toBeGreaterThan(0);
            expect(output).toContain('fish-lsp');
            expect(output).toContain('Usage:');

            resolve();
          });

          // Set a timeout
          setTimeout(() => {
            helpProcess.kill();
            reject(new Error('Help test timed out'));
          }, 5000);
        } catch (error: any) {
          reject(new Error(`Help test setup failed: ${error.message}`));
        }
      });
    }, 10000); // 10 second timeout for the test
  });

  describe('env', () => {
    const runEnvCommand = async (args: string[]): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        try {
          const envProcess = spawn('node', ['-r', 'tsx/cjs', 'src/cli.ts', 'env', ...args], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
          });

          let stdout = '';
          let stderr = '';

          envProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          envProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          envProcess.on('error', (error: any) => {
            reject(new Error(`Env process error: ${error.message}`));
          });

          envProcess.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`Env command failed with exit code ${code}: ${stderr}`));
              return;
            }

            resolve(stdout + stderr);
          });

          setTimeout(() => {
            envProcess.kill();
            reject(new Error('Env test timed out'));
          }, 5000);
        } catch (error: any) {
          reject(new Error(`Env test setup failed: ${error.message}`));
        }
      });
    };

    it('fish-lsp env --names', async () => {
      const output = await runEnvCommand(['--names']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('fish_lsp_enabled_handlers');
      expect(output).toContain('fish_lsp_disabled_handlers');
      expect(output).toContain('fish_lsp_log_file');
      expect(output).toContain('fish_lsp_log_level');

      // Should not contain comments or values when using --names
      expect(output).not.toContain('#');
      expect(output).not.toContain('set -gx');
    }, 10000);

    it('fish-lsp env --names --joined', async () => {
      const output = await runEnvCommand(['--names', '--joined']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('fish_lsp_enabled_handlers');

      // Should be on a single line when using --joined
      const lines = output.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('fish_lsp_enabled_handlers');
      expect(lines[0]).toContain('fish_lsp_disabled_handlers');
    }, 10000);

    it('fish-lsp env --show-default', async () => {
      const output = await runEnvCommand(['--show-default']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('set -gx fish_lsp_enabled_handlers');
      expect(output).toContain('set -gx fish_lsp_disabled_handlers');
      expect(output).toContain('# $fish_lsp_enabled_handlers');
      expect(output).toContain('# Enables the fish-lsp handlers');

      // Check for some expected default values
      expect(output).toContain('set -gx fish_lsp_max_background_files 10000');
      expect(output).toContain('set -gx fish_lsp_enable_experimental_diagnostics false');
    }, 10000);

    it('fish-lsp env --show-default --no-comments', async () => {
      const output = await runEnvCommand(['--show-default', '--no-comments']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('set -gx fish_lsp_enabled_handlers');

      // Should not contain comments when using --no-comments
      expect(output).not.toContain('#');
    }, 10000);

    it('fish-lsp env --show-default --only fish_lsp_log_file,fish_lsp_log_level', async () => {
      const output = await runEnvCommand(['--show-default', '--only', 'fish_lsp_log_file,fish_lsp_log_level']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('set -gx fish_lsp_log_file');
      expect(output).toContain('set -gx fish_lsp_log_level');

      // Should not contain other variables when using --only
      expect(output).not.toContain('fish_lsp_enabled_handlers');
      expect(output).not.toContain('fish_lsp_max_background_files');
    }, 10000);

    it('fish-lsp env --show-default --no-global', async () => {
      const output = await runEnvCommand(['--show-default', '--no-global']);

      expect(output.length).toBeGreaterThan(0);

      // Should use 'set -lx' instead of 'set -gx' when using --no-global
      expect(output).toContain('set -lx fish_lsp_enabled_handlers');
      expect(output).not.toContain('set -gx fish_lsp_enabled_handlers');
    }, 10000);

    it('fish-lsp env --show-default --no-export', async () => {
      const output = await runEnvCommand(['--show-default', '--no-export']);

      expect(output.length).toBeGreaterThan(0);

      // Should use 'set -g' instead of 'set -gx' when using --no-export
      expect(output).toContain('set -g fish_lsp_enabled_handlers');
      expect(output).not.toContain('set -gx fish_lsp_enabled_handlers');
    }, 10000);

    it('fish-lsp env --create', async () => {
      const output = await runEnvCommand(['--create']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('set -gx fish_lsp_enabled_handlers');

      // --create should show current/default values for environment setup
      expect(output).toContain('fish_lsp');
    }, 10000);

    it('fish-lsp env help', async () => {
      const output = await runEnvCommand(['--help']);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('generate fish-lsp env variables');
      expect(output).toContain('--names');
      expect(output).toContain('--show-default');
      expect(output).toContain('--only');
    }, 10000);
  });

  describe('complete', () => {
    it('fish-lsp complete should generate valid fish syntax', async () => {
      // Generate the completions
      const completions = buildFishLspCompletions(commandBin);

      expect(completions).toBeDefined();
      expect(typeof completions).toBe('string');
      expect(completions.length).toBeGreaterThan(0);

      // Basic syntax checks
      expect(completions).toContain('complete -c fish-lsp');
      expect(completions).toContain('function __fish_lsp');
    });

    it('fish should parse fish-lsp completions without errors', async () => {
      // Generate the completions
      const completions = buildFishLspCompletions(commandBin);

      // Check that the completions contain our new --dump-parse-tree flag
      expect(completions).toContain('--dump-parse-tree');
      expect(completions).toContain('dump the tree-sitter parse tree of a file');

      return new Promise<void>((resolve, reject) => {
        try {
          // Test that fish can parse the completions without syntax errors
          const fishProcess = spawn('fish', ['-n'], { stdio: ['pipe', 'pipe', 'pipe'] });

          let stderr = '';

          fishProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          fishProcess.on('error', (error: any) => {
            if (error.code === 'ENOENT') {
              console.warn('Fish shell not available, skipping syntax validation test');
              resolve();
              return;
            }
            reject(new Error(`Fish process error: ${error.message}`));
          });

          fishProcess.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`Fish parsing failed with exit code ${code}: ${stderr}`));
              return;
            }

            // Fish should not output any syntax errors when parsing with -n flag
            if (stderr.trim() !== '') {
              reject(new Error(`Fish parsing produced errors: ${stderr}`));
              return;
            }

            resolve();
          });

          // Send the completions to fish
          fishProcess.stdin.write(completions);
          fishProcess.stdin.end();

          // Set a timeout
          setTimeout(() => {
            fishProcess.kill();
            reject(new Error('Fish parsing test timed out'));
          }, 5000);
        } catch (error: any) {
          reject(new Error(`Test setup failed: ${error.message}`));
        }
      });
    }, 10000); // 10 second timeout for the test
  });
});
