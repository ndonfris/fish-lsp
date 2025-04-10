import { accumulateStartupOptions } from '../src/utils/commander-cli-subcommands';
import { validHandlers } from '../src/config';
import { timeServerStartup } from '../src/utils/startup';
import { performHealthCheck } from '../src/utils/health-check';

describe('cli tests', () => {
  // Mock for process.exit that throws an error instead of exiting
  let mockExit: jest.SpyInstance;

  // Mock process.stdout.write
  const stdoutMock = jest.spyOn(process.stdout, 'write').mockImplementation();

  // Storage for captured output
  let capturedOutput: string[] = [];

  // Setup and teardown
  beforeEach(() => {
    // Clear previous output before each test
    capturedOutput = [];

    // Set up the process.exit mock
    // mockExit = jest.spyOn(process, 'exit').mockImplementation((code: string | number | null | undefined) => {
    //   // Instead of exiting, throw an error with the exit code
    //   // This error can be caught in your tests
    //   throw new Error(`PROCESS_EXIT_MOCK: ${code || 0}`);
    // });

    // Replace the mock implementation to capture output
    stdoutMock.mockImplementation((val: string | Uint8Array) => {
      // Convert Buffer to string if needed
      const str = val instanceof Uint8Array
        ? Buffer.from(val).toString('utf8')
        : val;

      // Split on newlines and add to capture array
      capturedOutput.push(...str.toString().split(/\n/));

      // Filter empty lines
      capturedOutput = capturedOutput.filter(line => line.length > 0);

      return true;
    });

    // Mock health check dependencies
    jest.mock('fs/promises', () => ({
      access: jest.fn().mockResolvedValue(undefined),
    }));

    jest.mock('../src/utils/exec', () => ({
      execAsyncFish: jest.fn().mockResolvedValue({ stdout: '3.5.0', stderr: '' }),
    }));
  });

  afterEach(() => {
    // Clear mocks after each test
    jest.resetAllMocks();
  });

  afterAll(() => {
    // Restore original implementations after all tests
    jest.restoreAllMocks();
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

  describe.skip('info', () => {
    it('fish-lsp info --time-startup', async () => {
      await timeServerStartup();
      // expect(await timeServerStartup()).toHaveBeenCalled();
    });

    it('fish-lsp info --check-health', async () => {
      await performHealthCheck();

      // Check for expected health check output
      expect(capturedOutput.some(line => line.includes('fish-lsp health check'))).toBeTruthy();
      expect(capturedOutput.some(line => line.includes('memory usage'))).toBeTruthy();
    });
  });

  describe.skip('help', () => {
    it('fish-lsp --help', async () => {
      // const originalArgv = process.argv;
      //
      // try {
      //   process.argv = ['node', 'fish-lsp', '--help'];
      //
      //   try {
      //     await jest.isolateModules(async () => {
      //       await import('../src/cli');
      //     });
      //   } catch (err) {
      //     // expect(err!.message!.split(':')[1]!.trim()).toBe('0');
      //   }
      // } finally {
      //   process.argv = originalArgv;
      // }
    });
  });
});
