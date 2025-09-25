import './utils/array-polyfills';
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, FishLspHelp, FishLspManPage, SourcesDict, SubcommandEnv, CommanderSubcommand, getBuildTypeString, PkgJson, SourceMaps } from './utils/commander-cli-subcommands';
import { Command, Option } from 'commander';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { logger } from './logger';
import { configHandlers, config, updateHandlers, validHandlers, Config, handleEnvOutput } from './config';
import { ConnectionOptions, ConnectionType, createConnectionType, maxWidthForOutput, startServer, timeServerStartup } from './utils/startup';
import { performHealthCheck } from './utils/health-check';
import { setupProcessEnvExecFile } from './utils/process-env';
import { handleCLiDumpParseTree } from './utils/dump-parse-tree';
import PackageJSON from '@package';
import chalk from 'chalk';
import vfs from './virtual-fs';

/**
 *  creates local 'commandBin' used for commander.js
 */
const createFishLspBin = (): Command => {
  const description = [
    'Description:',
    FishLspHelp().description || 'An LSP for the fish shell language',
  ].join('\n');
  FishLspHelp;
  const bin = new Command('fish-lsp')
    .description(description)
    .helpOption('-h, --help', 'show the relevant help info. Other `--help-*` flags are also available.')
    .version(PackageJSON.version, '-v, --version', 'output the version number')
    .enablePositionalOptions(true)
    .configureHelp({
      showGlobalOptions: false,
      sortSubcommands: true,
      commandUsage: (_) => FishLspHelp().usage,
    })
    .showSuggestionAfterError(true)
    .showHelpAfterError(true)
    .addHelpText('after', FishLspHelp().after);
  return bin;
};

// start adding options to the command
export const commandBin = createFishLspBin();

// hidden global options
commandBin
  .addOption(new Option('--help-man', 'show special manpage output').hideHelp(true))
  .addOption(new Option('--help-all', 'show all help info').hideHelp(true))
  .addOption(new Option('--help-short', 'show mini help info').hideHelp(true))
  .action(opt => {
    if (opt.helpMan) {
      const { path: _path, content } = FishLspManPage();
      logger.logToStdout(content.join('\n').trim());
    } else if (opt.helpAll) {
      const globalOpts = [new Option('-h, --help', 'show help'), ...commandBin.options];
      const allOpts = [
        ...globalOpts.map(o => o.flags),
        ...commandBin.commands.flatMap(c => c.options.map(o => o.flags)),
      ];

      const padAmount = Math.max(...allOpts.map(o => `${o}\t`.length));
      const subCommands = commandBin.commands.map((cmd) => {
        return [
          `  ${cmd.name()} ${cmd.usage()}\t${cmd.summary()}`,
          cmd.options.map(o => `    ${o.flags.padEnd(padAmount)}\t${o.description}`).join('\n'),
          ''].join('\n');
      });
      const { beforeAll, after } = FishLspHelp();
      logger.logToStdout(['NAME:',
        'fish-lsp - an lsp for the fish shell language',
        '',
        'USAGE: ',
        beforeAll,
        '',
        'DESCRIPTION:',
        '  ' + commandBin.description().split('\n').slice(1).join('\n').trim(),
        '',
        'OPTIONS:',
        '  ' + globalOpts.map(o => '  ' + o.flags.padEnd(padAmount) + '\t' + o.description).join('\n').trim(),
        '',
        'SUBCOMMANDS:',
        subCommands.join('\n'),
        '',
        'EXAMPLES:',
        after.split('\n').slice(2).join('\n'),
      ].join('\n').trim());
    } else if (opt.helpShort) {
      logger.logToStdout([
        'fish-lsp [OPTIONS]',
        'fish-lsp [COMMAND] [OPTIONS]',
        '',
        commandBin.description(),
      ].join('\n'));
    }
    return;
  });

// START
commandBin.command('start')
  .summary('start the lsp')
  .description('start the language server for a connection to a client')
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .option('--stdio', 'use stdin/stdout for communication (default)')
  .option('--node-ipc', 'use node IPC for communication')
  .option('--socket <port>', 'use TCP socket for communication')
  .option('--memory-limit <mb>', 'set memory usage limit in MB')
  .option('--max-files <number>', 'override the maximum number of files to analyze')
  .addHelpText('afterAll', [
    '',
    'Strings for \'--enable/--disable\' switches:',
    `${validHandlers?.map((opt, index) => {
      return index < validHandlers.length - 1 && index > 0 && index % 5 === 0 ? `${opt},\n` :
        index < validHandlers.length - 1 ? `${opt},` : opt;
    }).join(' ').split('\n').map(line => `\t${line.trim()}`).join('\n')}`,
    '',
    'Examples:',
    '\t>_ fish-lsp start --disable hover  # only disable the hover feature',
    '\t>_ fish-lsp start --disable complete logging index hover --dump',
    '\t>_ fish-lsp start --enable --disable logging complete codeAction',
    '\t>_ fish-lsp start --socket 3000  # start TCP server on port 3000 (useful for Docker)',
  ].join('\n'))
  .allowUnknownOption(false)
  .action(async (opts: CommanderSubcommand.start.schemaType) => {
    await setupProcessEnvExecFile();
    // NOTE: `config` is a global object, already initialized. Here, we are updating its
    // values passed from the shell environment, and then possibly overriding them with
    // the command line args.

    // use the `config` object's shell environment values to update the handlers
    updateHandlers(config.fish_lsp_enabled_handlers, true);
    updateHandlers(config.fish_lsp_disabled_handlers, false);

    // Handle max files option
    if (opts.maxFiles && !isNaN(parseInt(opts.maxFiles))) {
      config.fish_lsp_max_background_files = parseInt(opts.maxFiles);
    }
    //
    // // Handle memory limit
    if (opts.memoryLimit && !isNaN(parseInt(opts.memoryLimit))) {
      const limitInMB = parseInt(opts.memoryLimit);
      process.env.NODE_OPTIONS = `--max-old-space-size=${limitInMB}`;
    }
    //
    // Determine connection type
    const connectionType: ConnectionType = createConnectionType({
      stdio: opts.stdio,
      nodeIpc: opts.nodeIpc,
      socket: !!opts.socket,
    });
    const connectionOptions: ConnectionOptions = {};
    if (opts.socket) {
      connectionOptions.port = parseInt(opts.socket);
    }

    // override `configHandlers` with command line args
    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(commandBin.args);
    updateHandlers(enabled, true);
    updateHandlers(disabled, false);
    Config.fixPopups(enabled, disabled);

    // Dump the configHandlers, if requested from the command line. This stops the server.
    if (dumpCmd) {
      logger.logFallbackToStdout({ handlers: configHandlers });
      logger.logFallbackToStdout({ config: config });
      process.exit(0);
    }

    /* config needs to be used in `startServer()` below */
    startServer(connectionType, connectionOptions);
  });

// INFO
commandBin.command('info')
  .summary('show info about the fish-lsp')
  .description('the info about the `fish-lsp` executable')
  .option('--bin', 'show the path of the fish-lsp executable', false)
  .option('--path', 'show the path of the entire fish-lsp repo', false)
  .option('--build-time', 'show the path of the entire fish-lsp repo', false)
  .option('--build-type', 'show the build type being used', false)
  .option('-v, --version', 'show the version of the fish-lsp package', false)
  .option('--lsp-version', 'show the lsp version', false)
  .option('--capabilities', 'show the lsp capabilities', false)
  .option('--man-file', 'show the man file path', false)
  .option('--show', 'show the man file output', false)
  .option('--logs-file', 'show the logs file path', false)
  .option('--log-file', 'show the log file path', false)
  .option('--verbose', 'show debugging server info (capabilities, paths, version, etc.)', false)
  .option('--extra', 'show debugging server info (capabilities, paths, version, etc.)', false)
  .option('--health-check', 'run diagnostics and report health status', false)
  .option('--check-health', 'run diagnostics and report health status', false)
  .option('--time-startup', 'time the startup of the fish-lsp executable', false)
  .option('--time-only', 'alias to show only the time taken for the server to index files', false)
  .option('--use-workspace <PATH>', 'use the specified workspace path for `fish-lsp info --time-startup`', undefined)
  .option('--no-warning', 'do not show warnings in the output for `fish-lsp info --time-startup`', true)
  .option('--show-files', 'show the files being indexed during `fish-lsp info --time-startup`', false)
  .option('--source-maps', 'show source map information and management options', false)
  .option('--all', 'show all source maps (use with --source-maps)', false)
  .option('--all-paths', 'show the paths to all the source maps (use with --source-maps)', false)
  .option('--install', 'download and install source maps (use with --source-maps)', false)
  .option('--remove', 'remove source maps (use with --source-maps)', false)
  .option('--check', 'check source map availability (use with --source-maps)', false)
  .option('--status', 'show the status of all the source-maps available to the server (use with --source-maps)', false)
  .option('--dump-parse-tree [FILE]', 'dump the tree-sitter parse tree of a file (reads from stdin if no file provided)', undefined)
  .option('--no-color', 'disable color output for --dump-parse-tree', false)
  .option('--virtual-fs', 'show the virtual filesystem structure (like tree command)', false)
  .allowUnknownOption(false)
  // .allowExcessArguments(false)
  .action(async (args: CommanderSubcommand.info.schemaType) => {
    await setupProcessEnvExecFile();
    const capabilities = BuildCapabilityString()
      .split('\n')
      .map((line: string) => `  ${line}`).join('\n');

    const hasTimingOpts = args.timeStartup || args.timeOnly;
    args.warning = !hasTimingOpts && args.warning === true ? !args.warning : args.warning;
    // Variable to determine if we saw specific info requests
    let shouldExit = false;
    let exitCode = 0;

    let argsCount = CommanderSubcommand.countArgsWithValues('info', args);
    if (args.warning && !hasTimingOpts) {
      argsCount = argsCount - 1;
    }

    const sourceMaps = Object.values(SourceMaps);
    // immediately exit if the user requested a specific info
    CommanderSubcommand.info.handleBadArgs(args);

    if (args.dumpParseTree) {
      const status = await handleCLiDumpParseTree(args);
      process.exit(status);
    }

    // If the user requested specific info, we will try to show only the requested output.
    if (!args.verbose) {
      // handle the preferred args (`--time-startup`, `--health-check`, `--check-health`)
      if (args.timeStartup || args.timeOnly) {
        await timeServerStartup({
          workspacePath: args.useWorkspace,
          warning: args.warning,
          timeOnly: args.timeOnly,
          showFiles: args.showFiles,
        });
        process.exit(0);
      }
      if (args.healthCheck || args.checkHealth) {
        await performHealthCheck();
        process.exit(0);
      }

      // Handle sourcemaps (requires --source-maps or specific sourcemap options)
      if (args.sourceMaps) {
        exitCode = CommanderSubcommand.info.handleSourceMaps(args);
        shouldExit = true;
      }
      // normal info about the fish-lsp
      if (args.bin) {
        CommanderSubcommand.info.log(argsCount, 'Executable Path', PathObj.execFile);
        shouldExit = true;
      }
      if (args.path) {
        CommanderSubcommand.info.log(argsCount, 'Build Path', PathObj.path);
        shouldExit = true;
      }
      if (args.buildTime) {
        CommanderSubcommand.info.log(argsCount, 'Build Time', PkgJson.buildTime);
        shouldExit = true;
      }
      if (args.buildType) {
        CommanderSubcommand.info.log(argsCount, 'Build Type', getBuildTypeString());
        shouldExit = true;
      }
      if (args.capabilities) {
        CommanderSubcommand.info.log(argsCount, 'Capabilities', capabilities, true);
        shouldExit = true;
      }
      if (args.version) {
        CommanderSubcommand.info.log(argsCount, 'Build Version', PackageVersion);
        shouldExit = true;
      }
      if (args.lspVersion) {
        CommanderSubcommand.info.log(argsCount, 'LSP Version', PackageLspVersion, true);
        shouldExit = true;
      }
      // handle `[--man-file | --log-file] (--show)?`
      if (args.manFile || args.logFile || args.logsFile) {
        exitCode = CommanderSubcommand.info.handleFileArgs(args);
        shouldExit = true;
      }
      // handle `--virtual-fs`
      if (args.virtualFs) {
        argsCount = argsCount - 1;
        const tree = vfs.displayTree();
        CommanderSubcommand.info.log(argsCount, 'Virtual Filesystem', tree, true);
        shouldExit = true;
      }
    }
    if (!shouldExit || args.verbose) {
      CommanderSubcommand.info.log(argsCount, 'Executable Path', PathObj.execFile, true);
      CommanderSubcommand.info.log(argsCount, 'Build Location', PathObj.path, true);
      CommanderSubcommand.info.log(argsCount, 'Build Version', PackageVersion, true);
      CommanderSubcommand.info.log(argsCount, 'Build Time', PkgJson.buildTime, true);
      CommanderSubcommand.info.log(argsCount, 'Build Type', getBuildTypeString(), true);
      CommanderSubcommand.info.log(argsCount, 'Node Version', process.version, true);
      CommanderSubcommand.info.log(argsCount, 'LSP Version', PackageLspVersion, true);
      CommanderSubcommand.info.log(argsCount, 'Binary File', PathObj.bin, true);
      CommanderSubcommand.info.log(argsCount, 'Man File', PathObj.manFile, true);
      CommanderSubcommand.info.log(argsCount, 'Log File', config.fish_lsp_log_file, true);
      const sourceMapString = sourceMaps.length > 1 ? `\n${sourceMaps.join('\n')}` : sourceMaps.join('\n');
      CommanderSubcommand.info.log(argsCount, 'Sourcemaps', sourceMapString, true);
      if (args.extra || args.capabilities || args.verbose) {
        logger.logToStdout('_'.repeat(maxWidthForOutput()));
        CommanderSubcommand.info.log(argsCount, 'Capabilities', capabilities, false);
      }
    }
    process.exit(exitCode);
  });

// URL
commandBin.command('url')
  .summary('show helpful url(s) related to the fish-lsp')
  .description('show the related url to the fish-lsp')
  .option('--repo, --git', 'show the github repo')
  .option('--npm', 'show the npm package url')
  .option('--homepage', 'show the homepage')
  .option('--contributions', 'show the contributions url')
  .option('--wiki', 'show the github wiki')
  .option('--issues, --report', 'show the issues page')
  .option('--discussions', 'show the discussions page')
  .option('--clients-repo', 'show the clients configuration repo')
  .option('--sources-list', 'show a list of helpful sources')
  .option('--source-map', 'show source map download url for current version')
  .allowUnknownOption(false)
  .allowExcessArguments(false)
  .action(async (args: CommanderSubcommand.url.schemaType) => {
    const amount = Object.keys(args).length;
    if (amount === 0) {
      logger.logToStdout('https://fish-lsp.dev');
      process.exit(0);
    }

    Object.keys(args).forEach(key => logger.logToStdout(SourcesDict[key]?.toString() || ''));
    process.exit(0);
  });

// COMPLETE
commandBin.command('complete')
  .summary('generate fish shell completions')
  .description('the completions for the `fish-lsp` executable')
  .option('--names', 'show the feature names of the completions')
  .option('--names-with-summary', 'show names with their summary for a completions script')
  .option('--toggles', 'show the feature names of the completions')
  .option('--fish', 'show fish script')
  .option('--features', 'show features')
  .option('--env-variables', 'show env variables')
  .option('--env-variable-names', 'show env variable names')
  .description('copy completions output to fish-lsp completions file')
  .allowUnknownOption(false)
  .action(async (args: CommanderSubcommand.complete.schemaType) => {
    await setupProcessEnvExecFile();
    if (args.names) {
      commandBin.commands.forEach(cmd => logger.logToStdout(cmd.name()));
      process.exit(0);
    } else if (args.namesWithSummary) {
      commandBin.commands.forEach(cmd => logger.logToStdout(cmd.name() + '\t' + cmd.summary()));
      process.exit(0);
    } else if (args.fish) {
      logger.logToStdout(buildFishLspCompletions(commandBin));
      process.exit(0);
    } else if (args.features || args.toggles) {
      Object.keys(configHandlers).forEach((name) => logger.logToStdout(name.toString()));
      process.exit(0);
    } else if (args.envVariables) {
      Object.entries(Config.envDocs).forEach(([key, value]) => {
        logger.logToStdout(`${key}\\t'${value}'`);
      });
      process.exit(0);
    } else if (args.envVariableNames) {
      Object.keys(Config.envDocs).forEach((name) => logger.logToStdout(name.toString()));
      process.exit(0);
    }
    logger.logToStdout(buildFishLspCompletions(commandBin));
    process.exit(0);
  });

// ENV
commandBin.command('env')
  .summary('generate environment variables for lsp configuration')
  .description('generate fish-lsp env variables')
  .option('-c, --create', 'build initial fish-lsp env variables')
  .option('-s, --show', 'show the current fish-lsp env variables')
  .option('--show-default', 'show the default fish-lsp env variables')
  .option('--only <variables...>', 'only show specified variables (comma-separated)')
  .option('--no-comments', 'skip comments in output')
  .option('--no-global', 'use local env variables')
  .option('--no-local', 'do not use local scope for variables')
  .option('--no-export', 'don\'t export the variables')
  .option('--confd', 'output for piping to conf.d')
  .option('--names', 'show only the variable names')
  .option('--joined', 'print the names in a single line')
  .option('--json', 'output in JSON format')
  .allowUnknownOption(false)
  .allowExcessArguments(false)
  .action(async (args: SubcommandEnv.ArgsType) => {
    await setupProcessEnvExecFile();

    const outputType = SubcommandEnv.getOutputType(args);
    const opts = SubcommandEnv.toEnvOutputOptions(args);
    if (args.names) {
      let result = '';
      Object.keys(Config.envDocs).forEach((name) => {
        if (args?.only && args.only.length > 0 && !args.only.includes(name)) {
          logger.logToStderr(chalk.red(`\n[ERROR] Unknown variable name '${name} ' in --only option.`));
          logger.logToStderr(`Valid variable names are:\n${Object.keys(Config.envDocs).join(', ')}`);
          process.exit(1);
        }
        result += args.joined ? `${ name } ` : `${ name }\n`;
      });
      logger.logToStdout(result.trim());
      process.exit(0);
    }
    handleEnvOutput(outputType, logger.logToStdout, opts);
    process.exit(0);
  });

// Parsing the command now happens in the `src / main.ts` file, since our bundler
export function execCLI() {
  if (process.argv.length <= 2) {
    logger.logToStderr(chalk.red('[ERROR] No COMMAND provided to `fish - lsp`, displaying `fish - lsp--help` output.\n'));
    commandBin.outputHelp();
    logger.logToStdout('\nFor more help, use `fish - lsp--help - all` to see all commands and options.');
    process.exit(1);
  }
  // commandBin.parse(process.argv);
  commandBin.parse();
}
