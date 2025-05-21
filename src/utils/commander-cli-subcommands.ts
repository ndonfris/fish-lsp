import { readFileSync } from 'fs';
import { resolve } from 'path';
import PackageJSON from '../../package.json';
import { logger } from '../logger';

/**
 * Accumulate the arguments into two arrays, '--enable' and '--disable'
 * More than one enable/disable flag can be used, but the output will be
 * the stored across two resulting arrays (if both flags have values as input).
 * Handles some of the default commands, such as '--help', and '-s, --show'
 * from the command line args.
 */
export function accumulateStartupOptions(args: string[]): {
  enabled: string[];
  disabled: string[];
  dumpCmd: boolean;
} {
  const [_subcmd, ...options] = args;
  const filteredOptions = filterStartCommandArgs(options);
  const [enabled, disabled]: [string[], string[]] = [[], []];
  let dumpCmd = false;
  let current: string[];
  filteredOptions?.forEach(arg => {
    if (['--enable', '--disable'].includes(arg)) {
      if (arg === '--enable') {
        current = enabled;
      }
      if (arg === '--disable') {
        current = disabled;
      }
      return;
    }
    if (['-h', '--help', 'help'].includes(arg)) {
      // commandBin.commands.find(command => command.name() === subcmd)!.outputHelp();
      // process.exit(0);
      return;
    }
    if (['--dump'].includes(arg)) {
      logger.logToStdout('SEEN SHOW COMMAND! dumping...');
      dumpCmd = true;
      return;
    }
    if (arg.startsWith('-')) {
      return;
    }
    if (current) {
      current?.push(arg);
    }
  });
  return { enabled, disabled, dumpCmd };
}

// filter out the start command args that are not used for the --enable/--disable values
function filterStartCommandArgs(args: string[]): string[] {
  const filteredArgs = [];
  let skipNext = false;
  for (const arg of args) {
    // Skip this argument if the previous iteration marked it for skipping
    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Check if the current arg is one of the flags that take values
    if (arg === '--socket' || arg === '--max-files' || arg === '--memory-limit') {
      skipNext = true; // Skip both the flag and its value
      continue;
    }

    // Check if the current arg is one of the flags without values
    if (arg === '--stdio' || arg === '--node-ipc') {
      continue;
    }

    // For flags with values in the format --flag=value
    if (arg.startsWith('--socket=') || arg.startsWith('--max-files=') || arg.startsWith('--memory-limit=')) {
      continue;
    }

    // Otherwise, keep the argument
    filteredArgs.push(arg);
  }

  return filteredArgs;
}

// For the specific case of finding the fish-lsp executable path:
function getCurrentExecutablePath(): string {
  // If this is being run as a Node.js script
  if (process.argv[0] && process.argv[0].includes('node')) {
    // Return the script that was executed
    return process.argv[1]!;
  }

  // Otherwise, return the executable path itself
  return process.execPath;
}

/// HELPERS
export const smallFishLogo = () => '><(((°> FISH LSP';
export const RepoUrl = PackageJSON.repository?.url.slice(0, -4);
export const PackageVersion = PackageJSON.version;

export const PathObj: { [K in 'bin' | 'root' | 'repo' | 'manFile' | 'execFile' ]: string } = {
  ['bin']: resolve(__dirname.toString(), '..', '..', 'bin', 'fish-lsp'),
  ['root']: resolve(__dirname, '..', '..'),
  ['repo']: resolve(__dirname, '..', '..'),
  ['execFile']: getCurrentExecutablePath(),
  ['manFile']: resolve(__dirname, '..', '..', 'docs', 'man', 'fish-lsp.1'),
};

export const PackageLspVersion = PackageJSON.dependencies['vscode-languageserver-protocol']!.toString();

/**
 * shows last compile bundle time in server cli executable
 */
const getOutTime = () => {
  // @ts-ignore
  const buildFile = resolve(__dirname, '..', '..', 'out', 'build-time.txt');
  let buildTime = 'unknown';
  try {
    buildTime = readFileSync(buildFile, 'utf8');
  } catch (e) {
    logger.logToStdout('Error reading ./out/build-time.txt');
  }
  return buildTime.trim();
};

export const getBuildTimeString = () => {
  return getOutTime();
};

export const isPkgBinary = () => {
  return resolve(__dirname).startsWith('/snapshot/');
};

export const SourcesDict: { [key: string]: string; } = {
  repo: 'https://github.com/ndonfris/fish-lsp',
  git: 'https://github.com/ndonfris/fish-lsp',
  npm: 'https://npmjs.com/fish-lsp',
  homepage: 'https://fish-lsp.dev',
  contributing: 'https://github.com/ndonfris/fish-lsp/blob/master/docs/CONTRIBUTING.md',
  issues: 'https://github.com/ndonfris/fish-lsp/issues?q=',
  report: 'https://github.com/ndonfris/fish-lsp/issues?q=',
  wiki: 'https://github.com/ndonfris/fish-lsp/wiki',
  discussions: 'https://github.com/ndonfris/fish-lsp/discussions',
  clientsRepo: 'https://github.com/ndonfris/fish-lsp-language-clients/',
  sources: [
    'https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart',
    'https://github.com/microsoft/vscode-extension-samples/tree/main',
    'https://tree-sitter.github.io/tree-sitter/',
    'https://github.com/ram02z/tree-sitter-fish',
    'https://github.com/microsoft/vscode-languageserver-node/tree/main/testbed',
    'https://github.com/Beaglefoot/awk-language-server/tree/master/server',
    'https://github.com/bash-lsp/bash-language-server/tree/main/server/src',
    'https://github.com/oncomouse/coc-fish',
    'https://github.com/typescript-language-server/typescript-language-server#running-the-language-server',
    'https://github.com/neoclide/coc-tsserver',
    'https://www.npmjs.com/package/vscode-jsonrpc',
    'https://github.com/Microsoft/vscode-languageserver-node',
    'https://github.com/Microsoft/vscode-languageserver-node',
    'https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common',
    'https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common',
  ].join('\n'),
};

export const FishLspHelp = {
  beforeAll: `
       fish-lsp [-h | --help] [-v | --version] [--help-man] [--help-all] [--help-short]
       fish-lsp start [--enable | --disable] [--dump]
       fish-lsp info [--bare] [--repo] [--time] [--env]
       fish-lsp url [--repo] [--discussions] [--homepage] [--npm] [--contributions]
                    [--wiki] [--issues] [--client-repo] [--sources]
       fish-lsp env [-c | --create] [-s | --show] [--no-comments]
       fish-lsp complete`,
  usage: `fish-lsp [OPTION]
       fish-lsp [COMMAND [OPTION...]]`,
  // fish-lsp [start | logger | info | url | complete] [options]
  // fish-lsp [-h | --help] [-v | --version] [--help-man] [--help-all] [--help-short]
  description: [
    '  A language server for the `fish-shell`, written in typescript. Currently supports',
    `  the following feature set from '${PackageLspVersion}' of the language server protocol.`,
    '  More documentation is available for any command or subcommand via \'-h/--help\'.',
    '',
    '  The current language server protocol, reserves stdin/stdout for communication between the ',
    '  client and server. This means that when the server is started, it will listen for messages on',
    '  stdin/stdout. Command communication will be visible in `$fish_lsp_log_file`.',
    '',
    '  For more information, see the github repository:',
    `     ${SourcesDict.git}`,
  ].join('\n'),
  after: [
    '',
    'Examples:',
    '  # Default setup, with all options enabled',
    '  > fish-lsp start ',
    '',
    '  # Generate and store completions file:',
    '  > fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish',
  ].join('\n'),
};

export function FishLspManPage() {
  const manFile = PathObj.manFile;
  const content = readFileSync(manFile, 'utf8');
  return {
    path: resolve(PathObj.root, PathObj.manFile),
    content: content.split('\n'),
  };
}

export function BuildCapabilityString() {
  const done = '✔️ '; // const done: string = '✅'
  const todo = '❌'; // const todo: string = '❌'
  const statusString = [
    `${done} complete`,
    `${done} hover`,
    `${done} rename`,
    `${done} definition`,
    `${done} references`,
    `${done} diagnostics`,
    `${done} signatureHelp`,
    `${done} codeAction`,
    `${todo} codeLens`,
    `${done} documentLink`,
    `${done} formatting`,
    `${done} rangeFormatting`,
    `${done} refactoring`,
    `${done} executeCommand`,
    `${done} workspaceSymbol`,
    `${done} documentSymbol`,
    `${done} foldingRange`,
    `${done} fold`,
    `${done} onType`,
    `${done} onDocumentSaveFormat`,
    `${done} onDocumentSave`,
    `${done} onDocumentOpen`,
    `${done} onDocumentChange`,
    `${todo} semanticTokens`,
  ].join('\n');
  return statusString;
}
