import { execSubCommandCompletions } from './exec';
import { logger } from '../logger';

/**
 * Cache for command subcommands, enabling sync lookups during semantic token generation.
 * Populated asynchronously via fish subprocesses; triggers a refresh callback when new
 * entries arrive so the client re-pulls semantic tokens.
 */
class SubcommandCache {
  private _cache: Map<string, Set<string>> = new Map();
  private _pending: Set<string> = new Set();
  private _onPopulated: (() => void) | null = null;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Sync O(1) lookup — hot path for semantic tokens */
  hasSubcommand(command: string, subcommand: string): boolean {
    return this._cache.get(command)?.has(subcommand) ?? false;
  }

  /** Whether the cache already has an entry (even if empty) for this command */
  isResolved(command: string): boolean {
    return this._cache.has(command);
  }

  /** Fire-and-forget async population. Calls _onPopulated when done. */
  requestPopulate(command: string): void {
    if (this._cache.has(command) || this._pending.has(command)) return;
    this._pending.add(command);

    execSubCommandCompletions(command)
      .then(lines => {
        const subs = new Set<string>();
        for (const line of lines) {
          if (!line || line === '') continue;
          // completions come as "name\tdescription" — extract name
          const name = line.split('\t')[0]!.trim();
          // skip options, paths, variables, empty
          if (!name || name.startsWith('-') || name.startsWith('/') || name.startsWith('.') || name.startsWith('$')) continue;
          subs.add(name);
        }
        this._cache.set(command, subs);
        this._pending.delete(command);
        this._scheduleRefresh();
        logger.info(`subcommand-cache: populated '${command}' with ${subs.size} subcommands`);
      })
      .catch(() => {
        // Store empty set to prevent re-fetching
        this._cache.set(command, new Set());
        this._pending.delete(command);
      });
  }

  /** Eagerly populate known builtins that have subcommands */
  async initializeBuiltins(): Promise<void> {
    const builtins = [
      'string', 'path', 'status', 'math', 'bind', 'abbr',
      'complete', 'history', 'random', 'read',
    ];
    for (const cmd of builtins) {
      this.requestPopulate(cmd);
    }
  }

  /** Synchronously set cache entries (for testing or preloading) */
  setSubcommands(command: string, subcommands: string[]): void {
    this._cache.set(command, new Set(subcommands));
  }

  /** Set the callback invoked when new subcommands are cached */
  onPopulated(callback: () => void): void {
    this._onPopulated = callback;
  }

  /** Debounce refresh callback (200ms) to batch rapid discoveries */
  private _scheduleRefresh(): void {
    if (!this._onPopulated) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._onPopulated?.();
    }, 200);
  }
}

export const subcommandCache = new SubcommandCache();
