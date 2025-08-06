#!/usr/bin/env node
//'use strict'

// Import polyfills for Node.js 18 compatibility
import './utils/array-polyfills';
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesDict, SubcommandEnv, CommanderSubcommand, getBuildTypeString, PkgJson, SourceMaps } from './utils/commander-cli-subcommands';
import { Command, Option } from 'commander';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { logger } from './logger';
import { configHandlers, config, updateHandlers, validHandlers, Config, handleEnvOutput } from './config';
import { ConnectionOptions, ConnectionType, createConnectionType, maxWidthForOutput, startServer, timeServerStartup } from './utils/startup';
import { performHealthCheck } from './utils/health-check';
import { setupProcessEnvExecFile } from './utils/process-env';

/**
 *  creates local 'commandBin' used for commander.js
 */
const createFishLspBin = (): Command => {
  const bin = new Command('fish-lsp')
    .description(`Description:\n${FishLspHelp?.description || 'fish-lsp command output'}`)
    .helpOption('-h, --help', 'show the relevant help info. Use `--help-all` for comprehensive documentation of all commands and flags. Other `--help-*` flags are also available.')
    .version(PkgJson?.version || 'latest', '-v, --version', 'output the version number')
    .enablePositionalOptions(true)
    .configureHelp({
      showGlobalOptions: false,
      commandUsage: (_) => FishLspHelp?.usage,
    })
    .showSuggestionAfterError(true)
    .showHelpAfterError(true)
    .addHelpText('after', FishLspHelp?.after);
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
      const globalOpts = commandBin.options.concat(new Option('-h, --help', 'show help'));
      const subCommands = commandBin.commands.map((cmd) => {
        return [
          `  ${cmd.name()} ${cmd.usage()}\t${cmd.summary()}`,
          cmd.options.map(o => `    ${o.flags}\t\t${o.description}`).join('\n'),
          ''].join('\n');
      });
      logger.logToStdout(['NAME:',
        'fish-lsp - an lsp for the fish shell language',
        '',
        'USAGE: ',
        FishLspHelp.beforeAll,
        '',
        'DESCRIPTION:',
        '  ' + commandBin.description().split('\n').slice(1).join('\n').trim(),
        '',
        'OPTIONS:',
        '  ' + globalOpts.map(o => '  ' + o.flags + '\t' + o.description).join('\n').trim(),
        '',
        'SUBCOMMANDS:',
        subCommands.join('\n'),
        '',
        'EXAMPLES:',
        FishLspHelp.after.split('\n').slice(2).join('\n'),
      ].join('\n').trim());
    } else if (opt.helpShort) {
      logger.logToStdout([
        'Usage: fish-lsp ', commandBin.usage().split('\n').slice(0, 1),
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
  ].join('\n'))
  .action(async opts => {
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
    const connectionType: ConnectionType = createConnectionType(opts);
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
  .option('--source-maps', 'show source map information and management options', false)
  .option('--all', 'show all source maps (use with --source-maps)', false)
  .option('--all-paths', 'show the paths to all the source maps (use with --source-maps)', false)
  .option('--install', 'download and install source maps (use with --source-maps)', false)
  .option('--remove', 'remove source maps (use with --source-maps)', false)
  .option('--check', 'check source map availability (use with --source-maps)', false)
  .option('--status', 'show the status of all the source-maps available to the server (use with --source-maps)', false)
  .action(async (args: CommanderSubcommand.info.schemaType) => {
    await setupProcessEnvExecFile();
    const capabilities = BuildCapabilityString()
      .split('\n')
      .map((line: string) => `  ${line}`).join('\n');

    // Variable to determine if we saw specific info requests
    let shouldExit = false;
    let exitCode = 0;

    let argsCount = CommanderSubcommand.countArgsWithValues('info', args);

    // immediately exit if the user requested a specific info
    CommanderSubcommand.info.handleBadArgs(args);

    // If the user requested specific info, we will try to show only the requested output.
    if (!args.verbose) {
      // handle the preferred args (`--time-startup`, `--health-check`, `--check-health`)
      if (args.timeStartup || args.timeOnly) {
        await timeServerStartup({
          workspacePath: args.useWorkspace,
          warning: args.warning,
          timeOnly: args.timeOnly,
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
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'Executable Path', PathObj.execFile);
        shouldExit = true;
      }
      if (args.path) {
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'Build Path', PathObj.path);
        shouldExit = true;
      }
      if (args.buildTime) {
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'Build Time', getBuildTimeString());
        shouldExit = true;
      }
      if (args.buildType) {
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'Build Type', getBuildTypeString());
        shouldExit = true;
      }
      if (args.capabilities) {
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'Capabilities', capabilities, true);
        shouldExit = true;
      }
      if (args.lspVersion) {
        argsCount = argsCount - 1;
        CommanderSubcommand.info.log(argsCount, 'LSP Version', PackageLspVersion, true);
        shouldExit = true;
      }
      // handle `[--man-file | --log-file] (--show)?`
      if (args.manFile || args.logFile || args.logsFile) {
        exitCode = CommanderSubcommand.info.handleFileArgs(args);
        shouldExit = true;
      }
    }
    if (!shouldExit || args.verbose) {
      CommanderSubcommand.info.log(argsCount, 'Executable Path', PathObj.execFile, true);
      CommanderSubcommand.info.log(argsCount, 'Build Location', PathObj.path, true);
      CommanderSubcommand.info.log(argsCount, 'Build Version', PackageVersion, true);
      CommanderSubcommand.info.log(argsCount, 'Build Time', getBuildTimeString(), true);
      CommanderSubcommand.info.log(argsCount, 'Build Type', getBuildTypeString(), true);
      CommanderSubcommand.info.log(argsCount, 'Node Version', process.version, true);
      CommanderSubcommand.info.log(argsCount, 'LSP Version', PackageLspVersion, true);
      CommanderSubcommand.info.log(argsCount, 'Binary File', PathObj.bin, true);
      CommanderSubcommand.info.log(argsCount, 'Man File', PathObj.manFile, true);
      CommanderSubcommand.info.log(argsCount, 'Log File', config.fish_lsp_log_file, true);
      CommanderSubcommand.info.log(argsCount, 'Sourcemaps', `\n${Object.values(SourceMaps).join('\n')}`, true);
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
  .option('--download', 'show download instructions')
  .action(async (args) => {
    const amount = Object.keys(args).length;
    if (amount === 0) {
      logger.logToStdout('https://fish-lsp.dev');
      process.exit(0);
    }

    // Handle source map URL (simplified - just show the download URL)
    if (args.download && args.sourceMap) {
      const sourceMapUrl = `https://github.com/ndonfris/fish-lsp/releases/download/v${PackageVersion}/sourcemaps.tar.gz`;
      logger.logToStdout(sourceMapUrl);
      logger.logToStdout('');
      logger.logToStdout('💡 For better source map management, use:');
      logger.logToStdout('   fish-lsp info --sourcemaps');
      process.exit(0);
    }

    if (args.download) {
      logger.logToStdout([
        `# Download fish-lsp v${PackageVersion}`,
        '',
        '## Binary (Recommended)',
        'curl -fsSL https://github.com/ndonfris/fish-lsp/releases/latest/download/fish-lsp -o fish-lsp',
        'chmod +x fish-lsp',
        'sudo mv fish-lsp /usr/local/bin/',
        '',
        '## NPM',
        'npm install -g fish-lsp',
        '',
        '## Source Maps (for debugging)',
        `curl -fsSL https://github.com/ndonfris/fish-lsp/releases/download/v${PackageVersion}/sourcemaps.tar.gz | tar -xz`,
        '',
        '## Source Map Management',
        'fish-lsp info --sourcemaps --install   # Install source maps',
        'fish-lsp info --sourcemaps --check     # Check status',
        'fish-lsp info --sourcemaps --remove    # Remove source maps',
      ].join('\n'));
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
  .action(async args => {
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
  .action(async (args: SubcommandEnv.ArgsType) => {
    await setupProcessEnvExecFile();
    const outputType = SubcommandEnv.getOutputType(args);
    const opts = SubcommandEnv.toEnvOutputOptions(args);
    if (args.names) {
      let result = '';
      Object.keys(Config.envDocs).forEach((name) => {
        if (args?.only && args.only.length > 0 && !args.only.includes(name)) return;
        result += args.joined ? `${name} ` : `${name}\n`;
      });
      logger.logToStdout(result.trim());
      process.exit(0);
    }
    handleEnvOutput(outputType, logger.logToStdout, opts);
    process.exit(0);
  });

/**
 * ADD HELP MESSAGE WHEN NO SUBCOMMAND IS GIVEN
 */
// if (process.argv.length <= 2 && process.env['NODE_TEST'] !== 'test') {
//   process.argv.push('--help')
// }

commandBin.parse();
