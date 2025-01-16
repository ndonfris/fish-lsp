#!/usr/bin/env node
//'use strict'
import { BuildCapabilityString, PathObj, PackageLspVersion, PackageVersion, accumulateStartupOptions, getBuildTimeString, FishLspHelp, FishLspManPage, SourcesDict, smallFishLogo, isPkgBinary } from './utils/commander-cli-subcommands';
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';
import { Command, Option } from 'commander';
import FishServer from './server';
import { buildFishLspCompletions } from './utils/get-lsp-completions';
import { createServerLogger, logToStdout, logToStdoutJoined } from './logger';
import { configHandlers, generateJsonSchemaShellScript, getConfigFromEnvironmentVariables, showJsonSchemaShellScript, updateHandlers, validHandlers } from './config';

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

async function timeOperation<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    const end = performance.now();
    const duration = end - start;
    logToStdoutJoined(
      `${label}:`.padEnd(55),
      `${duration.toFixed(2)}ms`.padStart(10),
    );
    return result;
  } catch (error) {
    const end = performance.now();
    const duration = end - start;
    logToStdout(`${label} failed after ${duration.toFixed(2)}ms`);
    throw error;
  }
}

async function timeServerStartup() {
  // define a local server instance
  let server: FishServer | undefined;

  // 1. Time server creation and startup
  await timeOperation(async () => {
    const connection = createConnection(
      new StreamMessageReader(process.stdin),
      new StreamMessageWriter(process.stdout),
    );
    // connection.console.log('Starting FISH-LSP server');
    const startupParams: InitializeParams = {
      processId: process.pid,
      rootUri: process.cwd(),
      capabilities: {},
    };
    server = await FishServer.create(connection, startupParams);
    server.register(connection);
    server.initialize(startupParams);
    connection.listen();
    return server;
  }, 'Server Start Time');

  // 2. Time server initialization and background analysis
  await timeOperation(async () => {
    await server?.startBackgroundAnalysis();
  }, 'Background Analysis Time');

  // 3. Log the number of files indexed
  logToStdoutJoined(
    'Total Files Indexed: '.padEnd(55),
    `${server?.analyzer.amountIndexed} files`.padStart(10),
  );

  // 4. Log the directories indexed
  const all_indexed = config.fish_lsp_all_indexed_paths;
  logToStdoutJoined(
    "Indexed Files in '$fish_lsp_all_indexed_paths':".padEnd(55),
    `${all_indexed.length} paths`.padStart(10),
  );
  const maxItemLen = all_indexed.reduce((max, item) => Math.max(max, item.length), 0);
  const startStr = ' '.repeat(3);
  config.fish_lsp_all_indexed_paths.forEach((item, idx) => logToStdoutJoined(
    `${startStr}$fish_lsp_all_indexed_paths[${idx + 1}]  `.padEnd(64 - maxItemLen),
    `|${item}|`.padStart(maxItemLen + 2),
  ));
}

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

// create config to be used globally
export const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables();

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
      logToStdout(config.fish_lsp_logfile);
      process.exit(0);
    }
    logToStdout(`Repository: ${PathObj.repo}`);
    logToStdout(`Version: ${PackageVersion}`);
    logToStdout(`Build Time: ${getBuildTimeString()}`);
    logToStdout(`Install Type: ${isPkgBinary() ? 'standalone executable' : 'local build'}`);
    logToStdout(`Node Version: ${process.version}`);
    logToStdout(`LSP Version: ${PackageLspVersion}`);
    logToStdout(`Binary File: ${PathObj.bin}`);
    logToStdout(`Man File: ${PathObj.manFile}`);
    logToStdout(`Log File: ${config.fish_lsp_logfile}`);
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
  .option('--no-global', 'use local env variables')
  .option('--no-local', 'do not use local scope for variables')
  .option('--no-export', 'don\'t export the variables')
  .action(args => {
    if (args.show) {
      showJsonSchemaShellScript(args.comments, args.global, args.local, args.export);
      process.exit(0);
    }
    generateJsonSchemaShellScript(args.comments, args.global, args.local, args.export);
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
