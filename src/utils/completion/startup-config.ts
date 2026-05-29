import { config } from '../../config';
import { FishCompletionItemKind } from './types';
import { spawn } from 'child_process';
import { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { AutoloadedPathVariables } from '../process-env';

/**
 * A setup item's `command` is either:
 *  - a `string`: a fish command run (bundled with the other string commands) in a
 *    single `fish -Pc` process, OR
 *  - a `SetupCommandFn`: an async callback invoked directly in-process. Used to
 *    replace expensive fish invocations with cheaper native equivalents (e.g. the
 *    `$PATH` scan that replaces `complete --do-complete ''` for COMMAND).
 *
 * Either way the resolved value is a `string[]` of lines, processed identically
 * downstream (see `splitLine` / `collectItems`).
 */
export type SetupCommandFn = () => Promise<string[]> | string[];

export type SetupItem = {
  command: string | SetupCommandFn;
  detail: string;
  fishKind: FishCompletionItemKind;
  topLevel: boolean;
  skipMatchesInResponse?: boolean;
};

export const SetupItemsFromCommandConfig: SetupItem[] = [
  // {
  //   command: `[ (abbr --show | count) -eq 0 ] ||  abbr --show | string split ' -- ' -m1 -f2 | string unescape`,
  //   detail: 'abbreviation',
  //   fishKind: FishCompletionItemKind.ABBR,
  //   topLevel: true,
  // },
  {
    command: 'builtin --names',
    detail: 'builtin',
    fishKind: FishCompletionItemKind.BUILTIN,
    topLevel: true,
  },
  {
    command: '[ (alias | count) -eq 0 ] || alias | string collect | string unescape | string split \' \' -m1 -f2',
    detail: 'alias',
    fishKind: FishCompletionItemKind.ALIAS,
    topLevel: true,
  },
  {
    command: 'functions --all --names | string collect',
    detail: 'function',
    fishKind: FishCompletionItemKind.FUNCTION,
    topLevel: true,
  },
  {
    // Replaces `complete --do-complete '' | string match ... 'command'` (~500ms,
    // dominated by fish's completion engine) with a direct `$PATH` scan
    // (~90ms) that yields an equivalent set. See `enumeratePathCommands`.
    command: enumeratePathCommands,
    detail: 'command',
    fishKind: FishCompletionItemKind.COMMAND,
    topLevel: true,
  },
  {
    command: 'set --names',
    detail: 'variable',
    fishKind: FishCompletionItemKind.VARIABLE,
    topLevel: false,
  },
  {
    command: '[ (functions --handlers | count) -eq 0 ] || functions --handlers | string match -vr \'^Event \\w+\'',
    detail: 'event handler',
    fishKind: FishCompletionItemKind.EVENT,
    topLevel: false,
  },
];

export type SetupResult = SetupItem & { results: string[]; };

/**
 * Enumerate executable command names available on `$PATH`. Native replacement for
 * `complete --do-complete ''`, whose cost was fish's completion engine (loading
 * every completion script) rather than the listing itself. A `readdir` + exec-bit
 * scan produces an equivalent set ~5x faster and without spawning fish.
 *
 * `$PATH` (inherited) is the primary source; it is unioned best-effort with fish's
 * user paths so a server not launched from a fish shell still picks them up once
 * `setupProcessEnvExecFile()` has populated them.
 */
export async function enumeratePathCommands(): Promise<string[]> {
  const dirs = [...new Set([
    ...(process.env.PATH ?? '').split(':'),
    ...AutoloadedPathVariables.get('fish_user_paths'),
    ...AutoloadedPathVariables.get('__fish_added_user_paths'),
  ].filter(Boolean))];

  const names = new Set<string>();
  await Promise.all(dirs.map(async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
    await Promise.all(entries.map(async (entry: Dirent) => {
      if (entry.isDirectory()) return; // cheap skip without a stat call
      // stat() follows symlinks so "command link" entries resolve to their target.
      const s = await stat(join(dir, entry.name)).catch(() => null);
      if (s && s.isFile() && s.mode & 0o111) names.add(entry.name);
    }));
  }));
  return [...names];
}

export async function runSetupItems(
  items: SetupItem[] = SetupItemsFromCommandConfig,
): Promise<SetupResult[]> {
  const resultsByItem = new Map<SetupItem, string[]>();

  // String commands are bundled into a single `fish -Pc` process (one fish startup),
  // separated by a unique delimiter.
  const stringItems = items.filter(
    (item): item is SetupItem & { command: string; } => typeof item.command === 'string',
  );
  if (stringItems.length > 0) {
    const DELIMITER = `### __FISH_LSP_SEP__:${Math.random().toString(36)}:__FISH_LSP_SEP__ ###`;
    const script = stringItems
      .map((item) => `printf '${DELIMITER}'; begin; ${item.command}; end 2>/dev/null`)
      .join('\n');

    const shellCommand = config.fish_lsp_fish_path || 'fish';
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(shellCommand, ['-Pc', script]);
      let stdout = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.on('close', () => resolve(stdout));
      proc.on('error', reject);
    });

    // First segment is empty (delimiter is printed before each command)
    const segments = output.split(DELIMITER).slice(1);
    stringItems.forEach((item, i) => {
      resultsByItem.set(item, (segments[i] ?? '').split('\n').filter(Boolean));
    });
  }

  // Callback commands are invoked directly, concurrently with each other (and with
  // the fish spawn above).
  await Promise.all(
    items
      .filter((item) => typeof item.command !== 'string')
      .map(async (item) => {
        const lines = await (item.command as SetupCommandFn)();
        resultsByItem.set(item, lines.filter(Boolean));
      }),
  );

  // map results back to items in their original order
  return items.map((item) => ({ ...item, results: resultsByItem.get(item) ?? [] }));
}
