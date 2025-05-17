#!/usr/bin/env node
//'use strict'
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesDict, isPkgBinary } from './utils/commander-cli-subcommands';
import { Command, Option } from 'commander';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { logger } from './logger';
import { configHandlers, config, updateHandlers, validHandlers, Config, handleEnvOutput } from './config';
import { ConnectionOptions, ConnectionType, createConnectionType, startServer, timeServerStartup } from './utils/startup';
import { performHealthCheck } from './utils/health-check';

/**
 *  creates local 'commandBin' used for commander.js
 */
const createFishLspBin = (): Command => {
  const bin = new Command('fish-lsp')
    .description(`Description:\n${FishLspHelp.description || 'fish-lsp command output'}`)
    .helpOption('-h, --help', 'show the relevant help info. Use `--help-all` for comprehensive documentation of all commands and flags. Other `--help-*` flags are also available.')
    .version(PackageVersion, '-v, --version', 'output the version number')
    .enablePositionalOptions(true)
    .configureHelp({
      showGlobalOptions: false,
      commandUsage: (_) => FishLspHelp.usage,
    })
    .showSuggestionAfterError(true)
    .showHelpAfterError(true)
    .addHelpText('after', FishLspHelp.after);
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
    `${validHandlers.map((opt, index) => {
      return index < validHandlers.length - 1 && index > 0 && index % 5 === 0 ? `${opt},\n` :
        index < validHandlers.length - 1 ? `${opt},` : opt;
    }).join(' ').split('\n').map(line => `\t${line.trim()}`).join('\n')}`,
    '',
    'Examples:',
    '\t>_ fish-lsp start --disable hover  # only disable the hover feature',
    '\t>_ fish-lsp start --disable complete logging index hover --dump',
    '\t>_ fish-lsp start --enable --disable logging complete codeAction',
  ].join('\n'))
  .action(opts => {
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
    // logger.log({connectionType, connectionOptions: connectionOptions.port});

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
  .option('--bin', 'show the path of the fish-lsp executable')
  .option('--repo', 'show the path of the entire fish-lsp repo')
  .option('--build-time', 'show the path of the entire fish-lsp repo')
  .option('--lsp-version', 'show the lsp version')
  .option('--capabilities', 'show the lsp capabilities')
  .option('--man-file', 'show the man file path')
  .option('--logs-file', 'show the logs file path')
  .option('--log-file', 'show the log file path')
  .option('--more', 'show the build time of the fish-lsp executable')
  .option('--time-startup', 'time the startup of the fish-lsp executable')
  .option('--health-check', 'run diagnostics and report health status')
  .option('--check-health', 'run diagnostics and report health status')
  .action(async args => {
    const capabilities = BuildCapabilityString()
      .split('\n')
      .map(line => `  ${line}`).join('\n');
    if (args.timeStartup) {
      await timeServerStartup();
      process.exit(0);
    }
    if (args.bin) {
      logger.logToStdout(PathObj.execFile);
      process.exit(0);
    }
    if (args.repo) {
      logger.logToStdout(PathObj.repo);
      process.exit(0);
    }
    if (args.healthCheck || args.checkHealth) {
      await performHealthCheck();
      process.exit(0);
    }
    if (args.buildTime) {
      logger.logToStdout(`Build Time: ${getBuildTimeString()}`);
      process.exit(0);
    }
    if (args.capabilities) {
      logger.logToStdout(`Capabilities:\n${capabilities}`);
      process.exit(0);
    }
    if (args.lspVersion) {
      logger.logToStdout(`LSP Version: ${PackageLspVersion}`);
      process.exit(0);
    }
    if (args.manFile) {
      logger.logToStdout(PathObj.manFile);
      process.exit(0);
    }
    if (args.logsFile || args.logFile) {
      logger.logToStdout(config.fish_lsp_log_file);
      process.exit(0);
    }
    logger.logToStdout(`Executable Path: ${PathObj.execFile}`);
    logger.logToStdout(`Build Location: ${PathObj.repo}`);
    logger.logToStdout(`Build Version: ${PackageVersion}`);
    logger.logToStdout(`Build Time: ${getBuildTimeString()}`);
    logger.logToStdout(`Install Type: ${isPkgBinary() ? 'standalone executable' : 'local build'}`);
    logger.logToStdout(`Node Version: ${process.version}`);
    logger.logToStdout(`LSP Version: ${PackageLspVersion}`);
    logger.logToStdout(`Binary File: ${PathObj.bin}`);
    logger.logToStdout(`Man File: ${PathObj.manFile}`);
    logger.logToStdout(`Log File: ${config.fish_lsp_log_file}`);
    logger.logToStdout('_'.repeat(parseInt(process.env.COLUMNS || '80')));
    logger.logToStdout('CAPABILITIES:');
    logger.logToStdout(capabilities);
    process.exit(0);
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
  .option('--sources', 'show a list of helpful sources')
  .action(args => {
    const amount = Object.keys(args).length;
    if (amount === 0) logger.logToStdout('https://fish-lsp.dev');
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
  .description('copy completions output to fish-lsp completions file')
  .action(args => {
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
  .action(args => {
    const only = args.only ?
      typeof args.only === 'string' ? args.only.split(',') : args.only :
      undefined;
    const outputType = args.showDefault ? 'showDefault' : args.show ? 'show' : 'create';
    handleEnvOutput(outputType, logger.logToStdout, { ...args, only });
    process.exit(0);
  });

/**
 * ADD HELP MESSAGE WHEN NO SUBCOMMAND IS GIVEN
 */
// if (process.argv.length <= 2 && process.env['NODE_TEST'] !== 'test') {
//   process.argv.push('--help')
// }

/**
 * PARSE THE SUBCOMMAND/OPTION
 */
commandBin.parse();
