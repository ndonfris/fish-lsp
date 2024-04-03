#!/usr/bin/env node
//'use strict'
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';
import { Argument, Command, Option } from 'commander';
import FishServer from './server';
import * as luaJson from 'lua-json';
import { asciiLogoString, BuildCapabilityString, RepoUrl, PathObj, PackageLspVersion, GetEnvVariablesUsed, PackageVersion, accumulateStartupOptions, getBuildTimeString } from './utils/commander-cli-subcommands';
import { mainStartupManager, bareStartupManger, ConfigMap } from './utils/configuration-manager';
import { buildFishLspCompletions } from './utils/get-lsp-completions';

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

export function startWebscoket() {
  // Create a connection for the server.
  // The connection uses stdin/stdout for communication.
  const connection = createConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );
  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
      const server = await FishServer.create(connection, params);
      server.register(connection);
      return server.initialize(params);
    },
  );
  connection.listen();
}

const createFishLspBin = (): Command => {
  const bin = new Command('fish-lsp');
  bin.description([
    'A language server for the `fish-shell`, written in typescript. Currently supports ',
    'the following feature set from "' + PackageLspVersion + '" of the language server protocol.',
    'More documentation is available for any command or subcommand via \'-h/--help\'.',
    '',
    'The current language server protocol, reserves stdin/stdout for communication between the ',
    'client and server. This means that when the server is started, it will listen for messages on',
    ' not displaying any output from the command.',
    '',
    'For more information, see the github repository:',
    `  ${RepoUrl}`,
  ].join('\n'))
    .version(PackageVersion, '-v, --version', 'output the version number')
    .enablePositionalOptions(true)
    .configureHelp({ helpWidth: 100 })
    .showSuggestionAfterError()
    .showHelpAfterError()
    .addHelpText('beforeAll', asciiLogoString('large') + '\n')
    .addHelpText('after', [
      '',
      'Examples:',
      '  # Default setup, with all options enabled',
      '  > fish-lsp start ',
      '',
      '  # Enable only the hover provider:',
      '  > fish-lsp bare --enable hover',
      '',
      '  # Generate and store completions file:',
      '  > fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish',
      '',
      '  # Show debug info from build:',
      '  > fish-lsp info',
      '',
    ].join('\n'));

  // .configureHelp(help=> {
  //         help.
  //     })
  // .storeOptionsAsProperties();

  return bin;
};

export const commandBin = createFishLspBin();

// @TODO
commandBin.command('start [TOGGLE...]')
  .summary('subcmd to start the lsp using stdin/stdout')
  .description('start the language server for a connection to a client')
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    'STRINGS FOR \'--enable/--disable\':',
    `(${ConfigMap.configNames.map((opt, index) => {
      return index < ConfigMap.configNames.length - 1 && index > 0 && index % 5 === 0 ? `${opt},\n` :
        index < ConfigMap.configNames.length - 1 ? `${opt},` : opt;
    }).join(' ')})`,
    '',
    'Examples:',
    '\tfish-lsp start --disable hover  # only disable the hover feature',
    '\tfish-lsp start --disable completion logging index hover --show',
    '\tfish-lsp start --enable --disable logging completion codeAction',
  ].join('\n'))
  .action(() => {
    const config: ConfigMap = mainStartupManager();
    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(commandBin.args);
    enabled.forEach(opt => config.toggleFeature(opt, true));
    disabled.forEach(opt => config.toggleFeature(opt, false));
    if (dumpCmd) {
      config.log();
      process.exit(0);
    }
    /* config needs to be used in `startServer()` below */
    startServer();
    // process.exit(0);
  });

// commandBin.command('mini')
//   .summary('subcmd to start the lsp using stdin/stdout with minimal indexing')
//   .description([
//         'Start the language server for a connection to a client with minimal indexing.',
//         'This is useful for large projects, where indexing can take a long time.',
//         'Also useful for running `edit_command_buffer` (editing prompt in tmp file).',
//     ].join(' '))
//   .action(() => {
//     // const startupConfig =
//     startServer();
//   });

commandBin.command('bare [TOGGLE...]')
  .alias('min')
  .alias('minimal')
  .summary('run barebones startup config')
  .description([
    'Initialize the fish-lsp with a completely minimal startup configuration.',
    'This is useful for running the language server with minimal indexing, debugging specific features',
    'and various other edge cases where the full feature set is not needed.',
  ].join('\n'))
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    'STRINGS FOR \'--enable/--disable\':',
    `(${ConfigMap.configNames.map((opt, index) => {
      return index < ConfigMap.configNames.length - 1 && index > 0 && index % 5 === 0 ? `${opt},\n` :
        index < ConfigMap.configNames.length - 1 ? `${opt},` : opt;
    }).join(' ')})`,
    '',
    'Examples:',
    '\tfish-lsp min --enable hover  # only enable the hover feature',
    '\tfish-lsp bare --enable all    # works like the \'start\' subcommand',
    '\tfish-lsp min --enable all --disable logging completion codeAction',
  ].join('\n'))
  .action(() => {
    const config: ConfigMap = bareStartupManger();
    const { enabled, disabled, dumpCmd } = accumulateStartupOptions(commandBin.args);
    enabled.forEach(opt => config.toggleFeature(opt, true));
    disabled.forEach(opt => config.toggleFeature(opt, false));
    if (dumpCmd) {
      config.log();
      process.exit(0);
    }
    // use config in startServer()
    startServer();
    // process.exit(0);
  });

// commandBin.command('capabilities')
//   .summary('show the capabilities of the language server')
//   .description('current capabilities of fish-lsp')
//   .action(() => {
//     console.log(asciiLogoString('large'));
//     console.log(BuildCapabilityString());
//     process.exit(0);
//   });

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
      console.log(PathObj.logsFile);
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

// @TODO
// .option('--vscode', 'show vscode-settings.json output')
// commandBin.command('startup-configuration')
//   .usage('[language-option]')
//   .summary('show the json/lua configurations for the language server')
//   .description('show the lua/json configurations for the language server')
//   .option('--json', 'show coc-settings.json output')
//   .option('--lua', 'show neovim *.lua output')
//   .action(args => {
//     if (args.json) {
//       console.log('coc-settings.json');
//       console.log(JSON.stringify({'hello': "world"}, null, 2));
//     } else if (args.lua) {
//       const jsonConf = JSON.parse(JSON.stringify({"todo" : [1, 2, 3], 'hello': "world"}))
//       console.log('neovim *.lua');
//       console.log(luaJson.format(jsonConf));
//     } else {
//       console.log('no option selected, coc-settings.json is default');
//     }
//     process.exit(0);
//   })

// @TODO
// commandBin.command('time')
//   .usage('--path [dir]')
//   .summary('time the fish-lsp server startup time to index the project files')
//   .requiredOption('--path [dir]', 'root directory of the fish project')
//   .action(args => {
//     const startTimer = Date.now();
//     const config: ConfigMap = mainStartupManager();
//     if (args.path) {
//         console.log(args.path)
//
//         const files = FastGlob.sync('**.fish', {
//             cwd: args.path,
//             absolute: true,
//             globstar: true,
//             dot: true,
//             })
//         // const parser = initializeParser();
//
//         const parser = initializeParser();
//         const workspace = Workspace.create(args.path);
//
//         // Promise.resolve()
//         files.map(async (file) => {
//                 console.log(file);
//                 const data = await readFile(file, 'utf8').then((data) => {
//                     return data
//                 })
//                 console.log(data)
//                 new Analyzer(await parser,  await workspace)
//                 // parser.parse(data);
//
//         })
//
//         // const paths: string[] = args.path || [`~/.config/fish/config.fish`];
//         // config.setKV('', value)
//         const endTimer = Date.now();
//         console.log(endTimer-startTimer, 'ms');
//     }
//   });

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
    if (args.repo || args.git) console.log('https://github.com/ndonfris/fish-lsp');
    if (args.npm) console.log('https://npmjs.io/ndonfris/fish-lsp');
    if (args.homepage) console.log('https://fish-lsp.dev');
    if (args.contributions) console.log('https://github.com/ndonfris/fish-lsp/issues?q=');
    if (args.wiki) console.log('https://github.com/ndonfris/fish-lsp/wiki');
    if (args.issues || args.report) console.log('https://github.com/ndonfris/fish-lsp/issues?q=');
    if (args.discussions) console.log('https://github.com/ndonfris/fish-lsp/discussions');
    if (args.clientsRepo) console.log('https://github.com/ndonfris/fish-lsp-language-clients/');
    if (args.sources) {
      console.log('https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart');
      console.log('https://github.com/microsoft/vscode-extension-samples/tree/main');
      console.log('https://tree-sitter.github.io/tree-sitter/');
      console.log('https://github.com/ram02z/tree-sitter-fish');
      console.log('https://github.com/microsoft/vscode-languageserver-node/tree/main/testbed');
      console.log('https://github.com/Beaglefoot/awk-language-server/tree/master/server');
      console.log('https://github.com/bash-lsp/bash-language-server/tree/main/server/src');
      console.log('https://github.com/oncomouse/coc-fish');
      console.log('https://github.com/typescript-language-server/typescript-language-server#running-the-language-server');
      console.log('https://github.com/neoclide/coc-tsserver');
      console.log('https://www.npmjs.com/package/vscode-jsonrpc');
      console.log('https://github.com/Microsoft/vscode-languageserver-node');
      console.log('https://github.com/Microsoft/vscode-languageserver-node');
      console.log('https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common');
      console.log('https://github.com/microsoft/vscode-languageserver-node/tree/main/server/src/common');
    }
    process.exit(0);
  });

// commandBin.command('contribute')
//   .summary('see the fish-lsp github repo')
//   .action(() => {
//     console.log(asciiLogoString('normal'));
//     console.log(RepoUrl);
//     process.exit(0);
//   });
//
// commandBin.command('report')
//   .summary('report an issue to the fish-lsp github repo')
//   .action(() => {
//     console.log(asciiLogoString('normal'));
//     console.log(RepoUrl + '/issues');
//     process.exit(0);
//   });

// commandBin.command('lsp-version')
//   .usage('lsp-version')
//   .summary('show the version of the language server protocol')
//   .description('show the version of the language server protocol')
//   .action(() => {
//     console.log(asciiLogoString('single') + '\n');
//     console.log('LSP version: ', PackageLspVersion);
//     process.exit(0);
//   });

// commandBin.command('show-env')
//   .usage('show-env')
//   .summary('show all the environment variables used by the lsp in current shell')
//   .description('show the environment variables of the language server')
//   .action(() => {
//     console.log('Environment Variables: ' + asciiLogoString('single'));
//     console.log(GetEnvVariablesUsed());
//     process.exit(0);
//   });

// @TODO
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

commandBin.parse();
