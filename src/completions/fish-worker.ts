import { ChildProcess, spawn } from 'child_process';
import { Socket } from 'net';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Completes NUL-terminated lines from stdin until it closes, ending each answer with
 * a NUL (fish strings can't hold one). Before the first request it prints what the
 * user's config printed, then the variable names it started with, each ended by a NUL.
 *
 * The line is read into `argv`, which fish always has, so completing `$` lists
 * nothing the worker added. A completion that reads stdin (`complete -a '(cat)'`)
 * reads the request pipe whatever the `complete` builtin's redirections, so only one
 * request is ever in the pipe: such a completion finds nothing and times out.
 */
const WORKER_SCRIPT = [
  "printf '\\0'",
  'set --names',
  "printf '\\0'",
  'while read -lz argv',
  '    complete --do-complete="$argv"',
  "    printf '\\0'",
  'end',
].join('\n');

/** a request slower than this means the worker is stuck */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * How long a worker serves requests before a fresh one replaces it. A running fish
 * keeps the config, `$PATH` and completion files it loaded at startup (it re-reads an
 * edited completion file only after ~15s, and adds it to what it loaded before).
 */
const MAX_WORKER_AGE_MS = 30_000;

/** one worker per set of excluded completion directories (see `shellComplete()`) */
const MAX_WORKERS = 3;

/** workers in a row that died before answering anything; past this, fish is spawned per request */
const MAX_FAILED_STARTS = 3;

/**
 * What a spawned fish inherits: the environment (`$PATH`, `$fish_complete_path`, …)
 * and the directory relative paths complete against. A worker whose snapshot no
 * longer matches is replaced, as a fresh `fish -c` would have seen the change.
 */
function spawnSnapshot(): string {
  return `${process.cwd()}\0${JSON.stringify(process.env)}`;
}

type Request = {
  line: string;
  resolve: (stdout: string) => void;
  reject: (error: Error) => void;
};

/**
 * A fish process kept running to answer `complete --do-complete` requests. A fresh
 * `fish -c` loads the user's config (`config.fish`, `conf.d/`) on every request,
 * which takes far longer than completing the line. Lines are sent as data, never
 * as code, one at a time, in the order they were asked for.
 */
export class FishCompletionWorker {
  readonly startedAt = Date.now();
  readonly snapshot = spawnSnapshot();
  /** resolves once the config has loaded, rejects if the worker dies first */
  readonly ready: Promise<void>;

  private child: ChildProcess;
  private queue: Request[] = [];
  private inFlight: { request: Request; timer: NodeJS.Timeout; } | null = null;
  private stdout = '';
  /** answers read so far, counting the config's output and the variable names */
  private answers = 0;
  /** the variables fish had once its config loaded */
  private variables = new Set<string>();
  /** no more requests are taken */
  private closed = false;
  private stopped = false;
  private markReady!: () => void;
  private markFailed!: (error: Error) => void;

  constructor(fishPath: string, initCommand?: string, private timeoutMs = REQUEST_TIMEOUT_MS) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.markReady = resolve;
      this.markFailed = reject;
    });
    this.ready.catch(() => { /* reported through `complete()` */ });

    const args = [...initCommand ? ['-C', initCommand] : [], '-c', WORKER_SCRIPT];
    this.child = spawn(fishPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => this.read(chunk));
    this.child.stdin!.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    // `close`, not `exit`: every answer written before exiting has been read by then
    this.child.on('close', (code, signal) => this.fail(new Error(`fish completion worker exited (${signal ?? code})`)));

    // an idle worker must not keep the server, or a test run, alive
    this.child.unref();
    (this.child.stdin as Socket).unref();
    (this.child.stdout as Socket).unref();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** closed by `retire()` or `kill()` rather than by dying */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** `complete --do-complete=$line` output */
  complete(line: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error('fish completion worker is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ line, resolve, reject });
      this.send();
    });
  }

  /** answers the requests already asked for, then exits */
  retire(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopped = true;
    this.send();
  }

  kill(): void {
    this.stopped = true;
    this.fail(new Error('fish completion worker stopped'));
  }

  /** writes the next request once the previous one is answered */
  private send(): void {
    if (this.inFlight || this.child.stdin!.destroyed) return;
    const request = this.queue.shift();
    if (!request) {
      if (this.closed) this.child.stdin!.end();
      return;
    }
    const timer = setTimeout(() => this.fail(new Error('fish completion worker timed out')), this.timeoutMs);
    this.inFlight = { request, timer };
    this.child.stdin!.write(request.line + '\0');
  }

  private read(chunk: string): void {
    this.stdout += chunk;
    let end = this.stdout.indexOf('\0');
    while (end !== -1) {
      const output = this.stdout.slice(0, end);
      this.stdout = this.stdout.slice(end + 1);
      this.answers++;
      if (this.answers === 1) {
        // whatever the config printed
      } else if (this.answers === 2) {
        this.variables = new Set(output.split('\n'));
        this.markReady();
      } else if (this.inFlight) {
        const { request, timer } = this.inFlight;
        clearTimeout(timer);
        this.inFlight = null;
        request.resolve(this.withoutLeftoverVariables(output));
        this.send();
      }
      end = this.stdout.indexOf('\0');
    }
  }

  /**
   * A completion file sets globals when it loads (`git`'s `$__fish_git_*`), and a
   * running fish keeps them, so `$` would list them from then on. A fresh fish never
   * had them: drop every variable the worker didn't start with.
   *
   * Only lines fish describes as a `Variable:` name one: a path such as `foo$bar/` has
   * no description, and a variable can end in the `/` fish adds when the word expands
   * to a directory (`"$HOME$__fish_git_aliases/` with it empty).
   */
  private withoutLeftoverVariables(output: string): string {
    if (!output.includes('$')) return output;
    return output
      .split('\n')
      .filter((line) => {
        const [label = '', description = ''] = line.split('\t');
        if (!description.startsWith('Variable:')) return true;
        const name = /\$(\w+)\/?$/.exec(label)?.[1];
        return name === undefined || this.variables.has(name);
      })
      .join('\n');
  }

  private fail(error: Error): void {
    this.closed = true;
    this.markFailed(error);
    const pending = [...this.inFlight ? [this.inFlight.request] : [], ...this.queue.splice(0)];
    if (this.inFlight) clearTimeout(this.inFlight.timer);
    this.inFlight = null;
    pending.forEach(request => request.reject(error));
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
    }
  }
}

type Slot = {
  fishPath: string;
  initCommand?: string;
  current: FishCompletionWorker;
  /** replaces `current` once it has started */
  next?: FishCompletionWorker;
};

/** by fish path and init command, least recently used first */
const slots = new Map<string, Slot>();
let failedStarts = 0;

function startWorker(fishPath: string, initCommand?: string): FishCompletionWorker {
  const worker = new FishCompletionWorker(fishPath, initCommand);
  worker.ready.then(() => {
    failedStarts = 0;
  }, (error) => {
    if (worker.isStopped) return;
    failedStarts++;
    logger.warning('fish completion worker failed to start', error);
  });
  return worker;
}

/** starts a fresh worker for `slot`; it takes over once its config has loaded */
function replaceWorker(slot: Slot): void {
  if (slot.next) return;
  const next = startWorker(slot.fishPath, slot.initCommand);
  slot.next = next;
  next.ready.then(() => {
    if (slot.next !== next) return;
    const previous = slot.current;
    slot.current = next;
    slot.next = undefined;
    previous.retire();
  }, () => {
    if (slot.next === next) slot.next = undefined;
  });
}

function workerFor(initCommand?: string): FishCompletionWorker | null {
  if (failedStarts >= MAX_FAILED_STARTS) return null;
  const fishPath = config.fish_lsp_fish_path;
  const key = `${fishPath}\0${initCommand ?? ''}`;
  const snapshot = spawnSnapshot();
  let slot = slots.get(key);
  slots.delete(key);

  if (!slot) {
    slot = { fishPath, initCommand, current: startWorker(fishPath, initCommand) };
  } else if (slot.current.snapshot !== snapshot) {
    // the environment or directory changed: this request needs a fish started with it
    slot.current.retire();
    slot.current = slot.next?.snapshot === snapshot ? slot.next : startWorker(fishPath, initCommand);
    if (slot.next !== slot.current) slot.next?.kill();
    slot.next = undefined;
  } else if (slot.current.isClosed) {
    // it crashed or timed out: take over from it now
    slot.current = slot.next ?? startWorker(fishPath, initCommand);
    slot.next = undefined;
  } else if (Date.now() - slot.current.startedAt > MAX_WORKER_AGE_MS) {
    replaceWorker(slot);
  }
  slots.set(key, slot);

  for (const [oldKey, old] of slots) {
    if (slots.size <= MAX_WORKERS) break;
    slots.delete(oldKey);
    old.current.retire();
    old.next?.kill();
  }
  return slot.current;
}

/**
 * `complete --do-complete=$line` output from a running fish. `initCommand` runs once
 * when a worker starts (`fish -C`), so each distinct one gets its own worker.
 */
export function completeInWorker(line: string, initCommand?: string): Promise<string> {
  const worker = workerFor(initCommand);
  if (!worker) return Promise.reject(new Error('fish completion workers are disabled'));
  return worker.complete(line);
}

/** starts the default worker, so the first completion doesn't wait for fish to start */
export function startFishCompletionWorker(): void {
  workerFor();
}

/** replaces every worker: a saved file may be the config, a function or a completion */
export function refreshFishCompletionWorkers(): void {
  for (const slot of slots.values()) {
    // New requests after a save must use the new definitions, even while that
    // fish is starting. Already queued requests can finish on the old worker.
    const previous = slot.current;
    slot.next?.kill();
    slot.current = startWorker(slot.fishPath, slot.initCommand);
    slot.next = undefined;
    previous.retire();
  }
}

export function stopFishCompletionWorkers(): void {
  for (const slot of slots.values()) {
    slot.current.kill();
    slot.next?.kill();
  }
  slots.clear();
  failedStarts = 0;
}
