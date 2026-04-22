import { config } from '../../config';
import { FishCompletionItemKind } from './types';

export type SetupItem = {
  command: string;
  detail: string;
  fishKind: FishCompletionItemKind;
  topLevel: boolean;
};

export const SetupItemsFromCommandConfig: SetupItem[] = [
  // {
  //   command: `[ (abbr --show | count) -eq 0 ] ||  abbr --show | string split ' -- ' -m1 -f2 | string unescape`,
  //   detail: 'Abbreviation',
  //   fishKind: FishCompletionItemKind.ABBR,
  //   topLevel: true,
  // },
  {
    command: 'builtin --names',
    detail: 'Builtin',
    fishKind: FishCompletionItemKind.BUILTIN,
    topLevel: true,
  },
  {
    command: '[ (alias | count) -eq 0 ] || alias | string collect | string unescape | string split \' \' -m1 -f2',
    detail: 'Alias',
    fishKind: FishCompletionItemKind.ALIAS,
    topLevel: true,
  },
  {
    command: 'functions --all --names | string collect',
    detail: 'Function',
    fishKind: FishCompletionItemKind.FUNCTION,
    topLevel: true,
  },
  {
    // TODO: Confirm if `mkdir` is included in the output of this command (issue #154)
    //       @see https://github.com/ndonfris/fish-lsp/issues/154 for more details
    command: 'complete --do-complete \'\' | string match --regex --entire -- \'^\\S+\\s+command(?: link)?\$\'',
    // NOTE: keeping the argument  ( ^^ ) above seems to prevent fish from needing to be
    //       started with `--interactive` switch, saving ~100ms of time during execution
    //       of all commands defined here.
    detail: 'Command',
    fishKind: FishCompletionItemKind.COMMAND,
    topLevel: true,
  },
  {
    command: 'set --names',
    detail: 'Variable',
    fishKind: FishCompletionItemKind.VARIABLE,
    topLevel: false,
  },
  {
    command: '[ (functions --handlers | count) -eq 0 ] || functions --handlers | string match -vr \'^Event \\w+\'',
    detail: 'Event Handler',
    fishKind: FishCompletionItemKind.EVENT,
    topLevel: false,
  },
];

import { spawn } from 'child_process';

export type SetupResult = SetupItem & { results: string[]; };

export async function runSetupItems(
  items: SetupItem[] = SetupItemsFromCommandConfig,
): Promise<SetupResult[]> {
  const DELIMITER = `### __FISH_LSP_SEP__:${Math.random().toString(36)}:__FISH_LSP_SEP__ ###`;

  // build a single script that runs all commands in sequence, separating outputs with a unique delimiter
  const script = items
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

  // results are split by delimiter, and then we map them back to items
  return items.map((item, i) => ({
    ...item,
    results: (segments[i] ?? '').split('\n').filter(Boolean),
  }));
}
