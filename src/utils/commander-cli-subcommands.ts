import chalk from 'chalk';
import fs, { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path, { resolve } from 'path';
import { z } from 'zod';
import PackageJSON from '../../package.json';
import { commandBin } from '../cli';
import { config } from '../config';
import { logger } from '../logger';
import { SyncFileHelper } from './file-operations';
import { getCurrentExecutablePath, getFishBuildTimeFilePath, getManFilePath, getProjectRootPath, isBundledEnvironment } from './path-resolution';
import { maxWidthForOutput } from './startup';
import { vfs } from '../virtual-fs';

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

export namespace SubcommandEnv {

  export type ArgsType = {
    create?: boolean;
    show?: boolean;
    showDefault?: boolean;
    only?: string[] | string | undefined;
    comments?: boolean;
    global?: boolean;
    local?: boolean;
    export?: boolean;
    confd?: boolean;
    names?: boolean;
    joined?: boolean;
    json?: boolean;
  };

  export type HandlerOptionsType = {
    only: string[] | undefined;
    comments: boolean;
    global: boolean;
    local: boolean;
    export: boolean;
    confd: boolean;
    json: boolean;
  };

  export const defaultHandlerOptions: HandlerOptionsType = {
    only: undefined,
    comments: true,
    global: true,
    local: false,
    export: true,
    confd: false,
    json: false,
  };

  /**
   * Get the output type based on the cli env args
   * Only one of these options is allowed at a time:
   *   -c, --create    `create the default env file`
   *   --show-default: `same as --create`
   *   -s, --show:     `show the current values in use`
   * If `fish-lsp env` is called without any of the flags above, it will default to `create`
   */
  export function getOutputType(args: ArgsType): 'show' | 'create' | 'showDefault' {
    return args.showDefault ? 'showDefault' : args.show ? 'show' : 'create';
  }

  export function getOnly(args: ArgsType): string[] | undefined {
    if (args.only) {
      const only = Array.isArray(args.only) ? args.only : [args.only];
      return only.reduce((acc: string[], value) => {
        acc.push(...value.split(',').map(v => v.trim()));
        return acc;
      }, []);
    }
    return undefined;
  }

  export function toEnvOutputOptions(args: ArgsType): HandlerOptionsType {
    const only = getOnly(args);
    return {
      only,
      comments: args.comments ?? true,
      global: args.global ?? true,
      local: args.local ?? false,
      export: args.export ?? true,
      confd: args.confd ?? false,
      json: args.json ?? false,
    };
  }
}

export function getEnvOnlyArgs(cliEnvOnly: string | string[] | undefined): string[] | undefined {
  const splitOnlyValues = (v: string) => v.split(',').map(value => value.trim());
  const isValidOnlyInput = (v: unknown): v is string | string[] =>
    typeof v === 'string'
    || Array.isArray(v) && v.every((value) => typeof value === 'string');
  const onlyArrayBuilder = (v: string | string[]) => {
    if (typeof v === 'string') {
      return splitOnlyValues(v);
    }
    return v.reduce((acc: string[], value) => {
      acc.push(...splitOnlyValues(value));
      return acc;
    }, []);
  };
  if (!cliEnvOnly || !isValidOnlyInput(cliEnvOnly)) return undefined;
  const only = Array.from(cliEnvOnly);
  return onlyArrayBuilder(only);
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

/// HELPERS
export const smallFishLogo = () => '><(((°> FISH LSP';
export const RepoUrl = PackageJSON.repository?.url.slice(0, -4);
export const PackageVersion = PackageJSON.version;

export const PathObj: { [K in 'bin' | 'root' | 'path' | 'manFile' | 'execFile']: string } = {
  ['bin']: getCurrentExecutablePath(),
  ['root']: getProjectRootPath(),
  ['path']: getProjectRootPath(),
  ['execFile']: getCurrentExecutablePath(),
  ['manFile']: getManFilePath(),
};

export type VersionTuple = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

export namespace DepVersion {

  /**
   * Extracts the major, minor, and patch version numbers from a version string.
   */
  export function minimumNodeVersion(): VersionTuple {
    const versionString = PackageJSON.engines.node?.toString();
    const version = extract(versionString);
    if (!version) {
      return extract('>=20.0.0')!; // Fallback to a default version if extraction fails
    }
    return version;
  }

  export function extract(versionString: string): VersionTuple | null {
    // Match major.minor.patch, ignoring operators and prerelease/build metadata
    const match = versionString.match(/^[^\d]*(\d+)\.(\d+)\.(\d+)/);

    if (!match) return null;

    const [, majorStr, minorStr, patchStr] = match;

    return {
      major: parseInt(majorStr!, 10),
      minor: parseInt(minorStr!, 10),
      patch: parseInt(patchStr!, 10),
      raw: `${majorStr}.${minorStr}.${patchStr}`,
    };
  }

  export function compareVersions(a: VersionTuple, b: VersionTuple): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  }

  /**
   * Compares two version tuples and returns true if the current version satisfies the required version.
   * @param current - The current version tuple.
   * @param required - The required version tuple.
   * @returns true if current version is greater than or equal to required version, false otherwise.
   */
  export function satisfies(current: VersionTuple, required: VersionTuple): boolean {
    return compareVersions(current, required) >= 0;
  }
}

export const PackageLspVersion = PackageJSON.dependencies['vscode-languageserver-protocol']!.toString();

export const PackageNodeRequiredVersion = DepVersion.minimumNodeVersion();

/**
 * shows last compile bundle time in server cli executable
 */
const getOutTime = () => {
  // First check if build time is embedded via environment variable (for bundled version)
  if (process.env.FISH_LSP_BUILD_TIME) {
    try {
      const buildTimeData = JSON.parse(process.env.FISH_LSP_BUILD_TIME);
      return buildTimeData.timestamp || new Date(buildTimeData.isoTimestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
    } catch (e) {
      // If parsing fails, return as-is (fallback for old format)
      return process.env.FISH_LSP_BUILD_TIME;
    }
  }

  // Fallback to reading from file (for development version)
  const buildFile = getFishBuildTimeFilePath();
  try {
    const fileContent = readFileSync(buildFile, 'utf8');
    const buildTimeData = JSON.parse(fileContent);
    return buildTimeData.timestamp || buildTimeData.isoTimestamp;
  } catch (e) {
    logger.logToStderr(`Error reading build-time file: ${buildFile}`);
    logger.error([
      `Error reading build-time file: ${buildFile}`,
      `Could not read build time from file: ${e}`,
    ]);
    return 'unknown';
  }
};

export type BuildTimeJsonObj = {
  date: string | Date;
  timestamp: string;
  isoTimestamp: string;
  unix: number;
  version: string;
  nodeVersion: string;
  reproducible?: boolean;
  [key: string]: any;
};
export const getBuildTimeJsonObj = (): BuildTimeJsonObj | undefined => {
  // First check if build time is embedded via environment variable (for bundled version)
  if (process.env.FISH_LSP_BUILD_TIME) {
    try {
      const jsonObj: BuildTimeJsonObj = JSON.parse(process.env.FISH_LSP_BUILD_TIME);
      return { ...jsonObj, date: new Date(jsonObj.date) };
    } catch (e) {
      logger.logToStderr(`Error parsing embedded build-time JSON: ${e}`);
    }
  }

  // Fallback to reading from file (for development version)
  try {
    const jsonFile = getFishBuildTimeFilePath();
    const jsonContent = readFileSync(jsonFile, 'utf8');
    const jsonObj: BuildTimeJsonObj = JSON.parse(jsonContent);
    return { ...jsonObj, date: new Date(jsonObj.date) };
  } catch (e) {
    logger.logToStderr(`Error reading build-time JSON file: ${e}`);
    logger.error(`Error reading build-time JSON file: ${e}`);
  }
  return undefined;
};

export const isPkgBinary = () => {
  return typeof __dirname !== 'undefined' ? resolve(__dirname).startsWith('/snapshot/') : false;
};

/**
 * Detect if the binary is installed globally by checking if it's accessible via PATH
 */
export const isInstalledGlobally = (): boolean => {
  try {
    const execPath = getCurrentExecutablePath();

    // Check if the executable is in a global npm/yarn installation directory
    if (execPath.includes('/node_modules/.bin/') ||
      execPath.includes('/.npm/') ||
      execPath.includes('/.yarn/') ||
      execPath.includes('/usr/local/') ||
      execPath.includes('/opt/') ||
      execPath.includes('/.local/bin/')) {
      return true;
    }

    // Check if the current executable matches what would be found in PATH
    if (process.env.PATH) {
      const pathDirs = process.env.PATH.split(':');
      for (const dir of pathDirs) {
        const potentialPath = resolve(dir, 'fish-lsp');
        if (execPath === potentialPath || execPath.startsWith(potentialPath)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
};

/**
 * Detect the execution context: module, web, binary, or unknown
 * Also differentiates between direct execution and node execution
 */
export const getExecutionContext = (): 'module' | 'web' | 'binary' | 'node-binary' | 'node-module' | 'unknown' => {
  const execPath = getCurrentExecutablePath();
  const isNodeExecution = process.argv[0]?.includes('node');

  // Check if running in web context (no real filesystem paths)
  if (typeof (globalThis as any).window !== 'undefined' || typeof (globalThis as any).self !== 'undefined') {
    return 'web';
  }

  // Locations where the CLI Binary might be run from
  const cliPaths = ['/bin/fish-lsp', '/dist/fish-lsp', '/out/cli.js'];

  // Check if running as CLI binary
  if (cliPaths.some(path => execPath.endsWith(path))) {
    return isNodeExecution ? 'node-binary' : 'binary';
  }

  // Server/module execution paths
  const modulePaths = ['/out/server.js', '/dist/server.js', '/src/server.ts'];
  if (modulePaths.some(path => execPath.endsWith(path))) {
    return isNodeExecution ? 'node-module' : 'module';
  }

  // Default to unknown context
  return 'unknown';
};

/**
 * Generate build type string in format: (local|global) (bundled?) (module|web|binary)
 */
export const getBuildTypeString = (): string => {
  const result: string[] = [];

  // 1. Installation type: local or global
  const installType = isInstalledGlobally() ? 'global' : 'local';
  result.push(installType);

  // 2. Bundling status: bundled or not
  if (isPkgBinary()) {
    result.push('pkg-bundle'); // Special case for pkg bundling
  } else if (isBundledEnvironment() || getCurrentExecutablePath().includes('/dist/')) {
    result.push('bundled');
  }

  // 3. Execution context: module, web, or binary
  const context = getExecutionContext();
  result.push(context);

  return result.join(' ').trim();
};

export const packageJsonVersion = () => {
  return PackageJSON.version || JSON.parse(fs.readFileSync(path.join(getProjectRootPath(), 'package.json'), 'utf8')).version;
};

export const PkgJson = {
  ...PackageJSON,
  name: PackageJSON.name,
  version: PackageJSON.version,
  description: PackageJSON.description,
  npm: 'https://www.npmjs.com/fish-lsp',
  repository: PackageJSON.repository?.url.replace(/^git\+/, '') || ' ',
  homepage: PackageJSON.homepage || ' ',
  lspVersion: PackageLspVersion,
  node: PackageNodeRequiredVersion,
  man: getManFilePath(),
  buildTime: getOutTime(),
  buildTimeObj: getBuildTimeJsonObj(),
  ...PathObj,
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
  sourceMap: `https://github.com/ndonfris/fish-lsp/releases/download/v${PackageVersion}/sourcemaps.tar.gz`,
  sourcesList: [
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

export function FishLspHelp() {
  const lspV = PackageJSON.dependencies['vscode-languageserver'].toString();
  return {

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
      `  the following feature set from '${lspV || PackageLspVersion || '^9.0.1'}' of the language server protocol.`,
      '  More documentation is available for any command or subcommand via \'-h/--help\'.',
      '',
      '  The current language server protocol, reserves stdin/stdout for communication between the ',
      '  client and server. This means that when the server is started, it will listen for messages on',
      '  stdin/stdout. Command communication will be visible in `$fish_lsp_log_file`.',
      '',
      `  For more info, please visit: ${chalk.underline('https://github.com/ndonfris/fish-lsp')}`,
    ].join('\n'),
    after: [
      '',
      'Examples:',
      '  # Default setup, with all options enabled',
      '  > fish-lsp start',
      '',
      '  # Generate and store completions file:',
      '  > fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish',
    ].join('\n'),
  };
}

export function FishLspManPage() {
  // Try to get man file from filesystem first (preferred - shows actual install location)
  const manFile = PathObj.manFile;
  if (manFile && existsSync(manFile)) {
    try {
      const content = readFileSync(manFile, 'utf8');
      return {
        path: manFile,
        content: content.split('\n'),
      };
    } catch {
      // File exists but can't read it, fall through to VFS
    }
  }

  // Fallback to embedded man page from VFS
  if (vfs && vfs.allFiles && Array.isArray(vfs.allFiles)) {
    try {
      const virtual = vfs.allFiles.find(f => {
        return f.filepath.endsWith('man/fish-lsp.1') || f.filepath.endsWith('man/man1/fish-lsp.1');
      });

      if (virtual && virtual.content) {
        // Show warning that we're using embedded version
        if (process.stderr.isTTY) {
          process.stderr.write('\x1b[33mWarning: Using embedded man page from virtual filesystem\x1b[0m\n');
        } else {
          process.stderr.write('Warning: Using embedded man page from virtual filesystem\n');
        }

        return {
          path: `${virtual.filepath} (embedded)`,
          content: virtual.content.toString().split('\n'),
        };
      }
    } catch (err) {
      // VFS access failed, continue to final error
    }
  }

  throw new Error('Man file not available');
}

export function fishLspLogFile() {
  const logFile = SyncFileHelper.expandEnvVars(config.fish_lsp_log_file);
  if (!logFile) {
    logger.error('fish_lsp_log_file is not set in the config file.');
    return {
      path: '',
      content: [],
    };
  }
  const content = SyncFileHelper.read(logFile).split('\n');
  return {
    path: resolve(logFile),
    content: content,
  };
}

export namespace CommanderSubcommand {

  // Define the subcommands and their schemas
  export namespace start {
    export const schema = z.record(z.unknown()).and(
      z.object({
        enable: z.array(z.string()).optional().default([]),
        disable: z.array(z.string()).optional().default([]),
        dump: z.boolean().optional().default(false),
        port: z.string().optional(),
        socket: z.string().optional(),
        maxFiles: z.string().optional(),
        memoryLimit: z.string().optional(),
        stdio: z.boolean().optional().default(false),
        nodeIpc: z.boolean().optional().default(false),
      }),
    );
    export type schemaType = z.infer<typeof schema>;
    export function parse(args: unknown): schemaType {
      const isValidArgs = schema.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : schema.parse(args) || defaultSchema; // Validate the args against the schema
    }
    export const defaultSchema: schemaType = schema.parse({});
  }
  export namespace info {
    export const schema = z.record(z.unknown()).and(
      z.object({
        bin: z.boolean().optional().default(false),
        path: z.boolean().optional().default(false),
        buildTime: z.boolean().optional().default(false),
        buildType: z.boolean().optional().default(false),
        version: z.boolean().optional().default(false),
        lspVersion: z.boolean().optional().default(false),
        capabilities: z.boolean().optional().default(false),
        manFile: z.boolean().optional().default(false),
        logFile: z.boolean().optional().default(false),
        logsFile: z.boolean().optional().default(false),
        show: z.boolean().optional().default(false),
        verbose: z.boolean().optional().default(false),
        extra: z.boolean().optional().default(false),
        healthCheck: z.boolean().optional().default(false),
        checkHealth: z.boolean().optional().default(false),
        timeStartup: z.boolean().optional().default(false),
        timeOnly: z.boolean().optional().default(false),
        useWorkspace: z.string().optional().default(''),
        warning: z.boolean().optional().default(true),
        showFiles: z.boolean().optional().default(false),
        sourceMaps: z.boolean().optional().default(false),
        check: z.boolean().optional().default(false),
        install: z.boolean().optional().default(false),
        remove: z.boolean().optional().default(false),
        status: z.boolean().optional().default(false),
        dumpParseTree: z.union([z.string(), z.boolean()]).optional().default(''),
        dumpSemanticTokens: z.union([z.string(), z.boolean()]).optional().default(''),
        virtualFs: z.boolean().optional().default(false),
      }),
    );
    export type schemaType = z.infer<typeof schema>;
    export function parse(args: unknown): schemaType {
      const isValidArgs = schema.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : schema.parse(args);
    }
    export const defaultSchema: schemaType = schema.parse({});
    export const skipable = z.object({
      healhCheck: z.boolean().default(false),
      checkHealth: z.boolean().default(false),
      timeStartup: z.boolean().default(false),
      timeOnly: z.boolean().default(false),
      useWorkspace: z.string().default(''),
      warning: z.boolean().default(true),
    });
    export type skipableType = z.infer<typeof skipable>;
    export type skipableArgs = keyof skipableType;

    export const parseSkip = (args: unknown): z.infer<typeof skipable> => {
      const isValidArgs = skipable.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : skipable.parse(args) || skipable.parse({}); // Validate the args against the schema
    };

    export const allSkipableArgvs = [
      'info',
      '--health-check',
      '--check-health',
      '--time-startup',
      '--time-only',
      '--use-workspace',
      '--no-warning',
      '--show-files',
    ] as const;

    export function handleBadArgs(args: schemaType) {
      const argsCount = countArgsWithValues('info', args);
      if (args.useWorkspace && args.useWorkspace.length > 0 && !args.timeStartup && !args.timeOnly && argsCount >= 1) {
        logger.logToStderr([
          buildErrorMessage('ERROR:', 'The option', '--use-workspace', 'should be used with either:', '--time-startup', 'or', '--time-only'),
          buildColoredCommandlineString({ subcommand: 'info', args: ['--time-startup', ...commandBin.args.slice(1)] }),
          buildErrorMessage(`If you believe this is a bug, please report it at ${chalk.underline.whiteBright(PkgJson.bugs.url)}`),
        ].join('\n\n'));
        process.exit(1);
      }
      const skippedArgs = commandBin.args.filter(arg => arg.startsWith('--') && allSkipableArgvs.some(skipable => arg.startsWith(skipable)));
      const unrelatedArgs = commandBin.args.filter(arg => arg.startsWith('--') && !allSkipableArgvs.some(skipable => arg.startsWith(skipable)));
      if (skippedArgs.length > 0 && unrelatedArgs.length > 0) {
        const unrelatedArgsSeen = argsToString(unrelatedArgs);
        logger.logToStderr([
          buildErrorMessage('ERROR:', 'Incompatible arguments provided.'),
          buildErrorMessage('FIXES:', 'Try removing the invalid arguments provided and running the command again.', 'INVALID ARGUMENTS:', ...unrelatedArgsSeen.replaceAll('"', '').split(', ')),
          buildColoredCommandlineString({ subcommand: 'info', args: skippedArgs }),
          buildErrorMessage(`If you believe this is a bug, please report it at ${chalk.underline.whiteBright(PkgJson.bugs.url)}`),
        ].join('\n\n'));
        process.exit(1);
      }
    }

    export function handleFileArgs(args: schemaType) {
      const seenArgs = keys(args).filter(k => ['manFile', 'logFile', 'logsFile'].includes(k));
      const otherArgs = keys(args).filter(k => !['manFile', 'logFile', 'logsFile', 'show'].includes(k));
      const argsCount = otherArgs.length >= 1 ? otherArgs.length + 1 + seenArgs.length : otherArgs.length + seenArgs.length || 0;
      const hasLogFile = args.logFile || args.logsFile;
      const hasManFile = args.manFile;
      const hasShowFlag = args.show;
      if (hasLogFile) {
        const logObj = fishLspLogFile();
        const title = 'Log File';
        const message = args.show ? logObj.content.join('\n') : logObj.path;
        log(argsCount, title, message);
      }
      if (hasManFile) {
        try {
          const manObj = FishLspManPage();
          const title = 'Man File';
          const message = args.show ? manObj.content.join('\n') : manObj.path;
          if (manObj.content && manObj.path.startsWith('/man')) {
            logger.logToStderr('\x1b[33mWarning: Displaying embedded\x1b[0m');
            log(argsCount, title + ' (embedded)', manObj.content.join('\n'));
            return;
          }
          log(argsCount, title, message);
        } catch (error) {
          log(argsCount, 'Man File', 'Error: Man file not available');
        }
      }
      if (!hasLogFile && !hasManFile && hasShowFlag) {
        logger.logToStderr([
          'ERROR: flag `--show` requires either `--log-file` or `-man-file`',
          'fish-lsp info [--log-file | --man-file] --show',
        ].join('\n'));
        return 1;
      }
      return 0;
    }

    // Show output for the sourcemaps switch
    export function handleSourceMaps(args: schemaType) {
      let exitStatus = 0;
      if (!args.sourceMaps) return exitStatus;

      // check if all sourcemaps are present
      Object.values(SourceMaps).forEach(v => {
        if (!fs.existsSync(v)) {
          exitStatus = 1;
        }
      });

      if (args.all && !args.allPaths) {
        logger.logToStdout('-'.repeat(maxWidthForOutput()));
        Object.entries(SourceMaps).forEach(([k, v]) => {
          const exists = fs.existsSync(v);
          logger.logToStdoutJoined(`${chalk.white('Sourcemap \'')}`, chalk.blue(k), chalk.white("': "), exists ? chalk.green('✅ Available') : chalk.red('❌ Not found'));
          if (exists) {
            const stats = fs.statSync(v);
            logger.logToStdoutJoined(chalk.white('Location: '), chalk.blue(`${v}`));
            logger.logToStdoutJoined(chalk.white('Size:     '), chalk.blue(`${(stats.size / 1024 / 1024).toFixed(1)} MB`));
            logger.logToStdoutJoined(chalk.white('Modified: '), chalk.blue(`${stats.mtime.toLocaleDateString()} ${stats.mtime.toLocaleTimeString()}`));
          }
          logger.logToStdout('-'.repeat(maxWidthForOutput())); // Add a blank line between maps
        });
        return exitStatus;
      }

      if (args.allPaths) {
        Object.entries(SourceMaps).forEach(([_, v]) => {
          logger.logToStdout(v);
        });
        return exitStatus;
      }

      if (args.check) {
        logger.logToStdout('-'.repeat(maxWidthForOutput())); // Add a blank line between maps
        Object.entries(SourceMaps).forEach(([k, v]) => {
          const exists = fs.existsSync(v);
          logger.logToStdoutJoined(`${chalk.white('Sourcemap \'')}`, chalk.blue(k), chalk.white("': "), exists ? chalk.green('✅ Available') : chalk.red('❌ Not found'));
          if (exists) {
            logger.logToStdout(`${chalk.white('Path:')} ${chalk.blue(v.replace(homedir(), '~'))}`);
          } else {
            logger.logToStdout(`${chalk.white('Path:')} ${chalk.blue(v.replace(homedir(), '~'))} ${chalk.red('(not found)')}`);
          }
          logger.logToStdout('-'.repeat(maxWidthForOutput())); // Add a blank line between maps
        });
        return exitStatus;
      }

      if (args.remove) {
        exitStatus = 0;
        Object.entries(SourceMaps).forEach(([_, v]) => {
          if (fs.existsSync(v)) {
            fs.unlinkSync(v);
            logger.logToStdout(`✅ Removed sourcemap at ${v.replace(homedir(), '~')}`);
          } else {
            logger.logToStdout(`❌ Sourcemap not found at ${v.replace(homedir(), '~')}, nothing to remove`);
            exitStatus = 1;
          }
        });
        return exitStatus;
      }

      if (args.install) {
        logger.logToStdout(`🔍 Download sourcemaps for v${PackageVersion}...`);

        const rootDir = getProjectRootPath();
        const sourceMapUrl = SourcesDict.sourceMap!.toString();
        logger.logToStdoutJoined(chalk.white('sourcemap url: '), chalk.blue(sourceMapUrl));
        logger.logToStdoutJoined(chalk.white('destination:  '), chalk.blue(path.join(rootDir, 'sourcemaps.tar.gz').replace(homedir(), '~')));
        return exitStatus;
      }

      // Default source map path
      logger.logToStdout('-'.repeat(maxWidthForOutput())); // Add a blank line between maps
      Object.entries(SourceMaps).forEach(([k, v]) => {
        const exists = fs.existsSync(v);
        logger.logToStdoutJoined(`${chalk.white('Sourcemap \'')}`, chalk.blue(k), chalk.white("': "), exists ? chalk.green('✅ Available') : chalk.red('❌ Not found'));
        if (exists) {
          logger.logToStdout(`${chalk.white('Path:')} ${chalk.blue(v.replace(homedir(), '~'))}`);
        } else {
          logger.logToStdout(`${chalk.white('Path:')} ${chalk.blue(v.replace(homedir(), '~'))} ${chalk.red('(not found)')}`);
        }
        logger.logToStdout('-'.repeat(maxWidthForOutput())); // Add a blank line between maps
      });
      return exitStatus;
    }

    export function log(argsCount: number, title: string, message: string, alwaysShowTitle = false) {
      const isCapabilitiesString = title.toLowerCase() === 'capabilities';
      if (isCapabilitiesString) message = `\n${message}`;
      if (argsCount > 1 || alwaysShowTitle || isCapabilitiesString) {
        logger.logToStdout(`${chalk.whiteBright.bold(`${title}:`)} ${chalk.cyan(message)}`);
      } else {
        logger.logToStdout(`${message}`);
      }
    }
  }
  export namespace url {
    export const schema = z.record(z.unknown()).and(
      z.object({
        repo: z.boolean().optional().default(false),
        discussions: z.boolean().optional().default(false),
        homepage: z.boolean().optional().default(false),
        npm: z.boolean().optional().default(false),
        contributions: z.boolean().optional().default(false),
        wiki: z.boolean().optional().default(false),
        issues: z.boolean().optional().default(false),
        clientRepo: z.boolean().optional().default(false),
        sources: z.boolean().optional().default(false),
        sourceMap: z.boolean().optional().default(false),
      }),
    );
    export type schemaType = z.infer<typeof schema>;
    export function parse(args: unknown): schemaType {
      const isValidArgs = schema.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : schema.parse(args) || defaultSchema; // Validate the args against the schema
    }
    export const defaultSchema: schemaType = schema.parse({});
  }

  export namespace complete {
    export const schema = z.record(z.unknown()).and(
      z.object({
        names: z.boolean().optional().default(false),
        namesWithSummary: z.boolean().optional().default(false),
        fish: z.boolean().optional().default(false),
        toggles: z.boolean().optional().default(false),
        features: z.boolean().optional().default(false),
        envVariables: z.boolean().optional().default(false),
        envVariablesNames: z.boolean().optional().default(false),
      }),
    );
    export type schemaType = z.infer<typeof schema>;
    export function parse(args: unknown): schemaType {
      const isValidArgs = schema.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : schema.parse(args) || defaultSchema; // Validate the args against the schema
    }
    export const defaultSchema: schemaType = schema.parse({});
  }

  export namespace env {
    export const schema = z.record(z.unknown()).and(
      z.object({
        create: z.boolean().optional().default(false),
        show: z.boolean().optional().default(false),
        showDefault: z.boolean().optional().default(false),
        only: z.union([z.string(), z.array(z.string())]).optional(),
        comments: z.boolean().optional().default(true),
        global: z.boolean().optional().default(true),
        local: z.boolean().optional().default(false),
        export: z.boolean().optional().default(true),
        confd: z.boolean().optional().default(false),
        names: z.boolean().optional().default(false),
        joined: z.boolean().optional().default(false),
      }),
    );
    export type schemaType = z.infer<typeof schema>;
    export function parse(args: unknown): schemaType {
      const isValidArgs = schema.safeParse(args);
      return isValidArgs?.success ? isValidArgs.data : schema.parse(args) || defaultSchema; // Validate the args against the schema
    }
    export const defaultSchema: schemaType = schema.parse({});
  }

  export const subcommands = [
    'start',
    'info',
    'url',
    'env',
    'complete',
  ] as const;
  export type SubcommandType = (typeof subcommands)[number];

  export type schemas = typeof start.schema
    | typeof info.schema
    | typeof url.schema
    | typeof env.schema
    | typeof complete.schema;

  const allSchemas = z.object({
    start: start.schema,
    info: info.schema,
    url: url.schema,
    env: env.schema,
    complete: complete.schema,
  });

  export function parseSubcommand(command: SubcommandType, args: unknown): z.infer<schemas> {
    switch (command) {
      case 'start':
        return start.schema.parse(args);
      case 'info':
        return info.schema.parse(args);
      case 'url':
        return url.schema.parse(args);
      case 'env':
        return env.schema.parse(args);
      case 'complete':
        return complete.schema.parse(args);
      default:
        throw new Error(`Unknown subcommand: ${command}`);
    }
  }

  export const getSchemaKeys = (schema: typeof allSchemas) => {
    // return schema.keyof()?._def.values;
    return [...schema.keyof().options];
  };

  export function hasSkipable(command: SubcommandType) {
    switch (command) {
      case 'info':
        return true;
      // No skipable
      case 'start':
      case 'complete':
      case 'url':
      case 'env':
        return false;
      default:
        throw new Error(`Unknown subcommand: ${command}`);
    }
  }

  export function getSubcommand(command: SubcommandType): schemas {
    switch (command) {
      case 'start':
        return start.schema;
      case 'info':
        return info.schema;
      case 'url':
        return url.schema;
      case 'env':
        return env.schema;
      case 'complete':
        return complete.schema;
      default:
        throw new Error(`Unknown subcommand: ${command}`);
    }
  }

  export function countArgsWithValues(subcommand: SubcommandType, args: Record<string, unknown>): number {
    const keysToCount = getSubcommand(subcommand).parse(args);
    const results: Record<string, boolean> = {};
    const skipableArgs = hasSkipable(subcommand);
    const removed: Record<string, boolean> = {};
    if (skipableArgs) {
      const skipable = info.skipable.parse(args);
      for (const key in skipable) {
        if (key === subcommand) removed[key] = true;
        if (skipable[key as keyof typeof skipable]) {
          removed[key] = false;
        }
      }
    }
    for (const key in keysToCount) {
      if (key === subcommand) removed[key] = true;
      if (removed[key]) continue;
      if (keysToCount[key]) results[key] = true;
    }
    return Object.keys(results).length;
  }

  export function removeArgs(args: { [k: string]: unknown; }, ...keysToRemove: string[]) {
    const argKeys = keys(args);
    return argKeys.filter((key) => !keysToRemove.includes(key));
  }

  export const countArgs = (args: any): number => {
    return keys(args).length;
  };

  export const keys = (args: { [k: string]: unknown; }) => {
    return Object.entries(args)
      .filter(([key, value]) => !!key && !!value && !(key === 'warning' && value === true))
      .map(([key, _]) => key);
  };

  export function entries(args: any) {
    return Object.entries(args)
      .filter(([key, value]) => !!key && !!value && !(key === 'warning' && value === true))
      .map(([key, _]) => key);
  }

  export function noArgs(args: any): boolean {
    return Object.keys(args).length === 0;
  }

  export function argsToString(args: { [k: string]: unknown; } | string[]): string {
    if (Array.isArray(args)) {
      return args.map(m => ['', m, ''].join('"')).join(', ');
    }
    return Object.keys(args).map(m => ['', m, ''].join('"')).join(', ');
  }

  export function buildErrorMessage(...stdin: string[]) {
    return stdin.map((item, idx) => {
      const splitItem = item.split(' ');
      return splitItem.map((part) => {
        if (idx === 0 && part.toUpperCase() === part) {
          return chalk.bold.red(part);
        }
        if (part.startsWith('--')) {
          return chalk.whiteBright(part);
        }
        return chalk.redBright(part);
      }).join(' ');
    }).join(' ');
  }
  export type CommandlineOpts = {
    subcommand: 'start' | 'info' | 'url' | 'env' | 'complete' | '';
    args?: string[];
    prefixIndent?: boolean;
    showPrompt?: boolean;
  };

  // default values for commandline options
  const commandlineOpts = {
    subcommand: '',
    args: [],
    prefixIndent: true,
    showPrompt: true,
  } as CommandlineOpts;

  export function buildColoredCommandlineString(opts: CommandlineOpts): string {
    // set the default values if not provided
    if (opts.prefixIndent === undefined) opts.prefixIndent = commandlineOpts.prefixIndent;
    if (opts.showPrompt === undefined) opts.showPrompt = commandlineOpts.showPrompt;

    const result: string[] = [];

    // format the initial part of the command line
    if (opts.prefixIndent) result.push('       ');
    if (opts.showPrompt) {
      if (result.length > 0) {
        result[0] = result[0] + chalk.whiteBright('>_');
      } else {
        result.push(chalk.whiteBright('>_'));
      }
    }
    // add the command and subcommand
    result.push(chalk.magenta('fish-lsp'));
    result.push(chalk.blue(opts.subcommand));
    // add the args if provided
    if (opts.args && opts.args.length > 0) {
      opts.args.forEach((arg: string) => {
        const toAddArg = arg.replaceAll(/"/g, '');
        if (toAddArg.includes('=')) {
          const [key, value] = toAddArg.split('=');
          result.push(`${chalk.white(key)}${chalk.bold.cyan('=')}${chalk.green(value)}`);
        } else {
          result.push(chalk.white(toAddArg));
        }
      });
    }
    // join the result with spaces
    return result.join(' ');
  }
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

/**
 * Record of the sourcemaps for each file in the project.
 */
export const SourceMaps: Record<string, string> = {
  'dist/fish-lsp': path.resolve(path.dirname(getCurrentExecutablePath()), '..', 'dist', 'fish-lsp.map'),
};
