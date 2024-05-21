#!/usr/bin/env node
//'use strict'
import { asciiLogoString, BuildCapabilityString, RepoUrl, PathObj, PackageLspVersion, GetEnvVariablesUsed, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesExt, SourcesDict } from './utils/commander-cli-subcommands';
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';
import { Command, Option } from 'commander';
import FishServer from './server';
// import * as luaJson from 'lua-json';
import { mainStartupManager, bareStartupManger, ConfigMap } from './utils/configuration-manager';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { createServerLogger, Logger, ServerLogsPath } from './logger';
import { configHandlers, generateJsonSchemaShellScript, getConfigFromEnvironmentVariables, showJsonSchemaShellScript, updateHandlers, validHandlers } from './config';
import { Server } from 'http';

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
      helpWidth: 100,
      showGlobalOptions: false,
      commandUsage: (_) => FishLspHelp.usage,
    })
    .showSuggestionAfterError()
    .showHelpAfterError()
    .addHelpText('after', FishLspHelp.after);
  return bin;
};

// create config to be used globablly
export const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables()

// start adding options to the command
export const commandBin = createFishLspBin();

// hidden global options
commandBin
  .addOption(new Option('--help-man', 'show special manpage output').hideHelp(true))
  .addOption(new Option('--help-all', 'show all help info').hideHelp(true))
  .addOption(new Option('--help-short', 'show mini help info').hideHelp(true))
  .action(opt => {
    if (opt.helpMan) {
      const { path, content } = FishLspManPage();
      console.log(content.join('\n').trim());
    } else if (opt.helpAll) {
      console.log('NAME:');
      console.log('fish-lsp - an lsp for the fish shell language');
      console.log();
      console.log('USAGE: ', FishLspHelp.beforeAll);
      console.log();
      console.log('DESCRIPTION:\n', commandBin.description().split('\n').slice(1).join('\n'));
      console.log();
      console.log('OPTIONS:');
      const globalOpts = commandBin.options.concat(new Option('-h, --help', 'show help'));
      console.log(globalOpts.map(o =>'  ' + o.flags + '\t' + o.description).join('\n'));
      console.log('\nSUBCOMMANDS:');
      commandBin.commands.forEach((cmd) => {
        console.log(`  ${cmd.name()} ${cmd.usage()}\t${cmd.summary()}`);
        console.log(cmd.options.map(o => `    ${o.flags}\t\t${o.description}`).join('\n'));
        console.log();
      });
      console.log('EXAMPLES:');
      console.log(FishLspHelp.after.split('\n').slice(2).join('\n'));
    } else if (opt.helpShort) {
      console.log('Usage: fish-lsp ', commandBin.usage().split('\n').slice(0, 1));
      console.log();
      console.log(commandBin.description());
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
    updateHandlers(config.fish_lsp_enabled_handlers, true)
    updateHandlers(config.fish_lsp_disabled_handlers, false)

    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(commandBin.args);
    updateHandlers(enabled, true)
    updateHandlers(disabled, false)
    if (dumpCmd) {
      console.log(JSON.stringify(configHandlers, null ,2))
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
    const logger = createServerLogger(config.fish_lsp_logfile || ServerLogsPath, false);
    const objArgs = Object.getOwnPropertyNames(args);
    const argsQueue = objArgs;
    let currentArg: string = '';
    while (argsQueue.length !== 0) {
      currentArg = argsQueue.shift() || '';
      if (currentArg === 'clear') logger.clearLogFile();
      if (currentArg === 'quiet') logger.toggleSilence();
      if (currentArg === 'date') logger.log(getBuildTimeString());
      if (currentArg === 'config') console.log(JSON.stringify(logger.getLoggingOpts()));
      if (currentArg === 'show') break;
    }

    if (!args.show) return;
    // if (args.show) logger.showLogfileText()
    logger.showLogfileText();
    return;
  });


// INFO
commandBin.command('info')
  .summary('show the build info of fish-lsp')
  .option('--bin', 'show the path of the fish-lsp executable')
  .option('--repo', 'show the path of the entire fish-lsp repo')
  .option('--time', 'show the path of the entire fish-lsp repo')
  .option('--env', 'show the env variables used')
  .option('--lsp-version', 'show the lsp version')
  .option('--capabilities', 'show the lsp capabilities')
  .option('--man-file', 'show the man file path')
  .option('--logs-file', 'show the logs.txt file path')
  .option('--more', 'show the build time of the fish-lsp executable')
  .action(args => {
    if (args.bin || args.repo) {
      const logPath = args.bin ? PathObj.bin : PathObj.repo;
      const wpath = args.bin ? 'BINARY' : 'REPOSITORY';
      console.log(wpath + ' ' + asciiLogoString('single'));
      console.log(logPath);
      process.exit(0);
    }
    if (args.time) {
      console.log('Build Time: ', getBuildTimeString());
      process.exit(0);
    }
    if (args.capabilities) {
      console.log(BuildCapabilityString());
      process.exit(0);
    }
    if (args.lspVersion) {
      console.log('LSP Version: ', PackageLspVersion);
      process.exit(0);
    }
    if (args.env) {
      console.log('Environment Variables: ' + asciiLogoString('single'));
      console.log(GetEnvVariablesUsed());
      process.exit(0);
    }
    if (args.manFile) {
      console.log(PathObj.manFile);
      process.exit(0);
    }
    if (args.logsFile) {
      console.log(config.fish_lsp_logfile || PathObj.logsFile);
      process.exit(0);
    }
    console.log('Repository: ', PathObj.repo);
    console.log('Build Time: ', getBuildTimeString());
    console.log('Version: ', PackageVersion);
    console.log('LSP Version: ', PackageLspVersion);
    console.log('Binary File: ', PathObj.bin);
    console.log('man file: ', PathObj.manFile);
    console.log('log file: ', PathObj.logsFile);
    console.log('CAPABILITIES:');
    console.log(BuildCapabilityString());
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
    if (amount === 0) console.log('https://fish-lsp.dev');
    Object.keys(args).forEach(key => console.log(SourcesDict[key]))
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
      commandBin.commands.forEach(cmd => console.log(cmd.name() + '\t' + cmd.summary()));
      process.exit(0);
    } else if (args.toggles) {
      commandBin.commands.forEach(cmd => {
        console.log(cmd.name() + '\t' + cmd.summary());
        Object.entries(cmd.opts()).forEach(opt => console.log('--' + opt[0]));
      });
      process.exit(0);
    } else if (args.fish) {
      console.log(buildFishLspCompletions(commandBin));
      process.exit(0);
    } else if (args.features) {
      ConfigMap.configNames.forEach(name => console.log(name));
      process.exit(0);
    }
    console.log(buildFishLspCompletions(commandBin));
    process.exit(0);
  });

// ENV
commandBin.command('env')
  .summary('generate fish shell env variables to be used by lsp')
  .description('generate fish-lsp env variables')
  .option('-c, --create', 'build initial fish-lsp env variables')
  .option('-s, --show',  'show the current fish-lsp env variables')
  .action(args => {
    if (args.show) {
      showJsonSchemaShellScript()
      process.exit(0)
    }
    generateJsonSchemaShellScript()
    process.exit(0)
  });

/**
 * PARSE THE SUBCOMMAND/OPTION
 */
commandBin.parse();