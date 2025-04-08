#!/usr/bin/env node
//'use strict'
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesDict, smallFishLogo, isPkgBinary } from './utils/commander-cli-subcommands';
import { Command, Option } from 'commander';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { logger } from './logger';
import { configHandlers, generateJsonSchemaShellScript, config, showJsonSchemaShellScript, updateHandlers, validHandlers, Config } from './config';
import { startServer, timeServerStartup } from './utils/startup';

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
commandBin.command('start [TOGGLE]')
  .summary('subcmd to start the lsp using stdin/stdout')
  .description('start the language server for a connection to a client')
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    'STRINGS FOR \'--enable/--disable\':',
    `(${validHandlers.map((opt, index) => {
      return index < validHandlers.length - 1 && index > 0 && index % 5 === 0 ? `${opt},\n` :
        index < validHandlers.length - 1 ? `${opt},` : opt;
    }).join(' ')})`,
    '',
    'Examples:',
    '\tfish-lsp start --disable hover  # only disable the hover feature',
    '\tfish-lsp start --disable complete logging index hover --show',
    '\tfish-lsp start --enable --disable logging complete codeAction',
  ].join('\n'))
  .action(() => {
    // NOTE: `config` is a global object, already initialized. Here, we are updating its
    // values passed from the shell environment, and then possibly overriding them with
    // the command line args.

    // use the `config` object's shell environment values to update the handlers
    updateHandlers(config.fish_lsp_enabled_handlers, true);
    updateHandlers(config.fish_lsp_disabled_handlers, false);

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
    startServer();
  });

// LOGGER
// commandBin.command('logger')
//   .summary('test the logger by displaying it')
//   .option('-s, --show', 'show the logger and don\'t edit it')
//   .option('-c, --clear', 'clear the logger')
//   .option('-d, --date', 'write the date')
//   .option('-q, --quiet', 'silence logging')
//   .option('--config', 'show the logger config')
//   .action(args => {
//     createServerLogger(config.fish_lsp_log_file);
//     const objArgs = Object.getOwnPropertyNames(args);
//     const argsQueue = objArgs;
//     let currentArg: string = '';
//     while (argsQueue.length !== 0) {
//       currentArg = argsQueue.shift() || '';
//     }
//
//     if (!args.show) return;
//     logger.showLogfileText();
//     return;
//   });

// INFO
commandBin.command('info')
  .summary('show the build info of fish-lsp')
  .option('--bin', 'show the path of the fish-lsp executable')
  .option('--repo', 'show the path of the entire fish-lsp repo')
  .option('--time', 'show the path of the entire fish-lsp repo')
  .option('--lsp-version', 'show the lsp version')
  .option('--capabilities', 'show the lsp capabilities')
  .option('--man-file', 'show the man file path')
  .option('--logs-file', 'show the logs file path')
  .option('--log-file', 'show the log file path')
  .option('--more', 'show the build time of the fish-lsp executable')
  .option('--time-startup', 'time the startup of the fish-lsp executable')
  .action(async args => {
    const capabilities = BuildCapabilityString()
      .split('\n')
      .map(line => `  ${line}`).join('\n');
    if (args.timeStartup) {
      await timeServerStartup();
      process.exit(0);
    }
    if (args.bin || args.repo) {
      const logPath = args.bin ? PathObj.bin : PathObj.repo;
      const wpath = args.bin ? 'BINARY' : 'REPOSITORY';
      logger.logToStdout(wpath + ' ' + smallFishLogo());
      logger.logToStdout(logPath);
      process.exit(0);
    }
    if (args.time) {
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
    logger.logToStdout(`Repository: ${PathObj.repo}`);
    logger.logToStdout(`Version: ${PackageVersion}`);
    logger.logToStdout(`Build Time: ${getBuildTimeString()}`);
    logger.logToStdout(`Install Type: ${isPkgBinary() ? 'standalone executable' : 'local build'}`);
    logger.logToStdout(`Node Version: ${process.version}`);
    logger.logToStdout(`LSP Version: ${PackageLspVersion}`);
    logger.logToStdout(`Binary File: ${PathObj.bin}`);
    logger.logToStdout(`Man File: ${PathObj.manFile}`);
    logger.logToStdout(`Log File: ${config.fish_lsp_log_file}`);
    logger.logToStdout('CAPABILITIES:');
    logger.logToStdout(capabilities);
    process.exit(0);
  });

// URL
commandBin.command('url')
  .summary('show a helpful url related to the fish-lsp')
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
  .summary('generate completions file for ~/.config/fish/completions')
  .option('--names', 'show the feature names of the completions')
  .option('--toggles', 'show the feature names of the completions')
  .option('--fish', 'show fish script')
  .option('--features', 'show features')
  .description('copy completions output to fish-lsp completions file')
  .action(args => {
    if (args.names) {
      commandBin.commands.forEach(cmd => logger.logToStdout(cmd.name() + '\t' + cmd.summary()));
      process.exit(0);
    } else if (args.toggles) {
      commandBin.commands.forEach(cmd => {
        logger.logToStdout(cmd.name() + '\t' + cmd.summary());
        Object.entries(cmd.opts()).forEach(opt => logger.logToStdout('--' + opt[0]));
      });
      process.exit(0);
    } else if (args.fish) {
      logger.logToStdout(buildFishLspCompletions(commandBin));
      process.exit(0);
    } else if (args.features) {
      Object.entries(configHandlers).forEach((name) => logger.logToStdout(name.toString()));
      process.exit(0);
    }
    logger.logToStdout(buildFishLspCompletions(commandBin));
    process.exit(0);
  });

// ENV
commandBin.command('env')
  .summary('generate fish shell env variables to be used by lsp')
  .description('generate fish-lsp env variables')
  .option('-c, --create', 'build initial fish-lsp env variables')
  .option('-s, --show', 'show the current fish-lsp env variables')
  .option('--no-comments', 'skip comments in output')
  .option('--no-global', 'use local env variables')
  .option('--no-local', 'do not use local scope for variables')
  .option('--no-export', 'don\'t export the variables')
  .option('--confd', 'output for piping to conf.d')
  .action(args => {
    if (args.show) {
      showJsonSchemaShellScript(args.confd || false, args.comments, args.global, args.local, args.export);
      process.exit(0);
    }
    generateJsonSchemaShellScript(args.confd || false, args.comments, args.global, args.local, args.export);
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
