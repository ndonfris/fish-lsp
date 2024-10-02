#!/usr/bin/env node
//'use strict'
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesDict, smallFishLogo } from './utils/commander-cli-subcommands';
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';
import { Command, Option } from 'commander';
import FishServer from './server';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { createServerLogger, logToStdout } from './logger';
import { configHandlers, generateJsonSchemaShellScript, getConfigFromEnvironmentVariables, showJsonSchemaShellScript, updateHandlers, validHandlers } from './config';
import { setupProcessEnvExecFile } from './utils/process-env';

export function startServer() {
  // Create a connection for the server.
  // The connection uses stdin/stdout for communication.
  const connection = createConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );
  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      connection.console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
      const server = await FishServer.create(connection, params);
      server.register(connection);
      return server.initialize(params);
    },
  );
  connection.listen();
}

/**
 *  creates local 'commandBin' used for commander.js
 */
const createFishLspBin = (): Command => {
  const bin = new Command('fish-lsp')
    .description(`Description:\n${FishLspHelp?.description.toString() || 'fish-lsp command output'}`)
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

// create config to be used globally
export const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables();
setupProcessEnvExecFile();

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
      logToStdout(content.join('\n').trim());
    } else if (opt.helpAll) {
      const globalOpts = commandBin.options.concat(new Option('-h, --help', 'show help'));
      const subCommands = commandBin.commands.map((cmd) => {
        return [
          `  ${cmd.name()} ${cmd.usage()}\t${cmd.summary()}`,
          cmd.options.map(o => `    ${o.flags}\t\t${o.description}`).join('\n'),
          ''].join('\n');
      });
      logToStdout(['NAME:',
        'fish-lsp - an lsp for the fish shell language',
        '',
        'USAGE: ',
        FishLspHelp.beforeAll,
        '',
        'DESCRIPTION:',
        commandBin.description().split('\n').slice(1).join('\n').trim(),
        '',
        'OPTIONS:',
        globalOpts.map(o => '  ' + o.flags + '\t' + o.description).join('\n').trimEnd(),
        '',
        'SUBCOMMANDS:',
        subCommands.join('\n'),
        '',
        'EXAMPLES:',
        FishLspHelp.after.split('\n').slice(2).join('\n'),
      ].join('\n').trim());
    } else if (opt.helpShort) {
      logToStdout([
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
    updateHandlers(config.fish_lsp_enabled_handlers, true);
    updateHandlers(config.fish_lsp_disabled_handlers, false);

    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(commandBin.args);
    updateHandlers(enabled, true);
    updateHandlers(disabled, false);
    if (dumpCmd) {
      logToStdout(JSON.stringify(configHandlers, null, 2));
      process.exit(0);
    }
    /* config needs to be used in `startServer()` below */
    startServer();
    //process.exit(0);
  });

// LOGGER
commandBin.command('logger')
  .summary('test the logger by displaying it')
  .option('-s, --show', 'show the logger and don\'t edit it')
  .option('-c, --clear', 'clear the logger')
  .option('-d, --date', 'write the date')
  .option('-q, --quiet', 'silence logging')
  .option('--config', 'show the logger config')
  .action(args => {
    const logger = createServerLogger(config.fish_lsp_logfile, false);
    const objArgs = Object.getOwnPropertyNames(args);
    const argsQueue = objArgs;
    let currentArg: string = '';
    while (argsQueue.length !== 0) {
      currentArg = argsQueue.shift() || '';
      if (currentArg === 'clear') logger.clearLogFile();
      if (currentArg === 'quiet') logger.toggleSilence();
      if (currentArg === 'date') logger.log(getBuildTimeString());
      if (currentArg === 'config') logToStdout(JSON.stringify(logger.getLoggingOpts()));
      if (currentArg === 'show') break;
    }

    if (!args.show) return;
    logger.showLogfileText();
    return;
  });

// INFO
commandBin.command('info')
  .summary('show the build info of fish-lsp')
  .option('--bin', 'show the path of the fish-lsp executable')
  .option('--repo', 'show the path of the entire fish-lsp repo')
  .option('--time', 'show the path of the entire fish-lsp repo')
  .option('--lsp-version', 'show the lsp version')
  .option('--capabilities', 'show the lsp capabilities')
  .option('--man-file', 'show the man file path')
  .option('--logs-file', 'show the logs.txt file path')
  .option('--more', 'show the build time of the fish-lsp executable')
  .action(args => {
    const capabilities = BuildCapabilityString()
      .split('\n')
      .map(line => `  ${line}`).join('\n');
    if (args.bin || args.repo) {
      const logPath = args.bin ? PathObj.bin : PathObj.repo;
      const wpath = args.bin ? 'BINARY' : 'REPOSITORY';
      logToStdout(wpath + ' ' + smallFishLogo());
      logToStdout(logPath);
      process.exit(0);
    }
    if (args.time) {
      logToStdout(`Build Time: ${getBuildTimeString()}`);
      process.exit(0);
    }
    if (args.capabilities) {
      logToStdout(`Capabilities:\n${capabilities}`);
      process.exit(0);
    }
    if (args.lspVersion) {
      logToStdout(`LSP Version: ${PackageLspVersion}`);
      process.exit(0);
    }
    if (args.manFile) {
      logToStdout(PathObj.manFile);
      process.exit(0);
    }
    if (args.logsFile) {
      logToStdout(config.fish_lsp_logfile || PathObj.logsFile);
      process.exit(0);
    }
    logToStdout(`Repository: ${PathObj.repo}`);
    logToStdout(`Build Time: ${getBuildTimeString()}`);
    logToStdout(`Version: ${PackageVersion}`);
    logToStdout(`LSP Version: ${PackageLspVersion}`);
    logToStdout(`Binary File: ${PathObj.bin}`);
    logToStdout(`man file: ${PathObj.manFile}`);
    logToStdout(`log file: ${PathObj.logsFile}`);
    logToStdout('CAPABILITIES:');
    logToStdout(capabilities);
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
    if (amount === 0) logToStdout('https://fish-lsp.dev');
    Object.keys(args).forEach(key => logToStdout(SourcesDict[key]?.toString() || ''));
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
      commandBin.commands.forEach(cmd => logToStdout(cmd.name() + '\t' + cmd.summary()));
      process.exit(0);
    } else if (args.toggles) {
      commandBin.commands.forEach(cmd => {
        logToStdout(cmd.name() + '\t' + cmd.summary());
        Object.entries(cmd.opts()).forEach(opt => logToStdout('--' + opt[0]));
      });
      process.exit(0);
    } else if (args.fish) {
      logToStdout(buildFishLspCompletions(commandBin));
      process.exit(0);
    } else if (args.features) {
      Object.entries(configHandlers).forEach((name) => logToStdout(name.toString()));
      process.exit(0);
    }
    logToStdout(buildFishLspCompletions(commandBin));
    process.exit(0);
  });

// ENV
commandBin.command('env')
  .summary('generate fish shell env variables to be used by lsp')
  .description('generate fish-lsp env variables')
  .option('-c, --create', 'build initial fish-lsp env variables')
  .option('-s, --show', 'show the current fish-lsp env variables')
  .option('--no-comments', 'skip comments in output')
  .action(args => {
    if (args.show) {
      showJsonSchemaShellScript(args.comments);
      process.exit(0);
    }
    generateJsonSchemaShellScript(args.comments);
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
