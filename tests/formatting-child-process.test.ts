import { EventEmitter } from 'events';
import { Writable } from 'stream';

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileOptions = { timeout?: number; maxBuffer?: number; };
type ExecFileMock = (cmd: string, args: string[], options: ExecFileOptions, callback: ExecFileCallback) => unknown;

function createMockProcess(stdin: Writable | null) {
  const childProcess = new EventEmitter() as EventEmitter & {
    stdin: Writable | null;
    kill: ReturnType<typeof vi.fn>;
  };

  childProcess.stdin = stdin;
  childProcess.kill = vi.fn();

  return childProcess;
}

function mockFormattingDependencies() {
  vi.doMock('../src/logger', () => ({
    logger: {
      log: vi.fn(),
    },
  }));
  vi.doMock('../src/parsing/comments', () => ({
    getEnabledIndentRanges: vi.fn(),
  }));
}

describe('formatting child process failures', () => {
  afterEach(() => {
    vi.doUnmock('child_process');
    vi.doUnmock('../src/logger');
    vi.doUnmock('../src/parsing/comments');
    vi.resetModules();
  });

  it('rejects when fish_indent closes stdin before content is written', async () => {
    vi.resetModules();
    mockFormattingDependencies();

    const execFile: ExecFileMock = vi.fn((_cmd, _args, _options, _callback) => {
      const stdin = new Writable({
        write(_chunk, _encoding, callback) {
          const error = new Error('write EPIPE') as NodeJS.ErrnoException;
          error.code = 'EPIPE';
          callback(error);
        },
      });

      return createMockProcess(stdin);
    });

    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('child_process')>();
      return { ...actual, execFile };
    });

    const { formatDocumentContent } = await import('../src/formatting');

    await expect(formatDocumentContent('echo test')).rejects.toThrow('write EPIPE');
  });

  it('rejects when fish_indent exits with an error', async () => {
    vi.resetModules();
    mockFormattingDependencies();

    const execFile: ExecFileMock = vi.fn((_cmd, _args, _options, callback) => {
      const stdin = new Writable({
        write(_chunk, _encoding, writeComplete) {
          writeComplete();
        },
      });
      const childProcess = createMockProcess(stdin);

      setImmediate(() => callback(new Error('fish_indent failed'), '', 'invalid fish syntax'));

      return childProcess;
    });

    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('child_process')>();
      return { ...actual, execFile };
    });

    const { formatDocumentContent } = await import('../src/formatting');

    await expect(formatDocumentContent('if')).rejects.toThrow('invalid fish syntax');
  });

  it('passes a timeout and maxBuffer to execFile so a hung child cannot stall the LSP', async () => {
    vi.resetModules();
    mockFormattingDependencies();

    const seenOptions: ExecFileOptions[] = [];
    const execFile: ExecFileMock = vi.fn((_cmd, _args, options, callback) => {
      seenOptions.push(options);
      const stdin = new Writable({
        write(_chunk, _encoding, writeComplete) {
          writeComplete();
        },
      });
      const childProcess = createMockProcess(stdin);
      setImmediate(() => callback(null, 'echo ok\n', ''));
      return childProcess;
    });

    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('child_process')>();
      return { ...actual, execFile };
    });

    const { formatDocumentContent } = await import('../src/formatting');
    await formatDocumentContent('echo ok');

    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]?.timeout).toBeGreaterThan(0);
    expect(seenOptions[0]?.maxBuffer).toBeGreaterThan(1024 * 1024);
  });

  it('reports a clear timeout error when execFile kills fish_indent for exceeding the deadline', async () => {
    vi.resetModules();
    mockFormattingDependencies();

    const execFile: ExecFileMock = vi.fn((_cmd, _args, _options, callback) => {
      const stdin = new Writable({
        write(_chunk, _encoding, writeComplete) {
          writeComplete();
        },
      });
      const childProcess = createMockProcess(stdin);

      setImmediate(() => {
        const err = new Error('Command failed') as NodeJS.ErrnoException & { killed: boolean; signal: NodeJS.Signals; };
        err.killed = true;
        err.signal = 'SIGTERM';
        callback(err, '', '');
      });

      return childProcess;
    });

    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('child_process')>();
      return { ...actual, execFile };
    });

    const { formatDocumentContent } = await import('../src/formatting');

    await expect(formatDocumentContent('echo waiting')).rejects.toThrow(/timed out/i);
  });

  it('reports a clear maxBuffer error when fish_indent output exceeds the buffer cap', async () => {
    vi.resetModules();
    mockFormattingDependencies();

    const execFile: ExecFileMock = vi.fn((_cmd, _args, _options, callback) => {
      const stdin = new Writable({
        write(_chunk, _encoding, writeComplete) {
          writeComplete();
        },
      });
      const childProcess = createMockProcess(stdin);

      setImmediate(() => {
        const err = new Error('stdout maxBuffer length exceeded') as NodeJS.ErrnoException;
        err.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        callback(err, '', '');
      });

      return childProcess;
    });

    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('child_process')>();
      return { ...actual, execFile };
    });

    const { formatDocumentContent } = await import('../src/formatting');

    await expect(formatDocumentContent('echo too-much')).rejects.toThrow(/exceeded/i);
  });
});
