#!/usr/bin/env node
//'use strict'
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from "vscode-languageserver/node";
import { Command } from 'commander';
import FishServer from './server';
import { asciiLogoString, BuildCapabilityString, RepoUrl, PathObj, PackageLspVersion, GetEnvVariablesUsed, PackageVersion, disableOptions } from './utils/commander-cli-subcommands';


export function startServer() {
  // Create a connection for the server.
  // The connection uses stdin/stdout for communication.
  const connection = createConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout)
  );
  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      connection.console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
      const server = await FishServer.create(connection, params);
      server.register(connection);
      return server.initialize(params);
    }
  );
  connection.listen();
}

const createFishLspBin = (): Command => {
  const bin = new Command('fish-lsp');
  bin.description([
    'A language server for the `fish-shell`, written in typescript. Currently supports ',
    'the following feature set from "' + PackageLspVersion + '" of the language server protocol:',
    BuildCapabilityString() + '\n',
    'For more information, see the github repository: ' + RepoUrl,
    'For help with the command line options, use the --help flag.',
  ].join('\n'));
  return bin;
};

const commandBin = createFishLspBin()
  .addHelpText('beforeAll', asciiLogoString('large') + '\n')
  .addHelpText('afterAll', [
      '________________________________________',
      'authored by: https://github.com/ndonfris',
      '     ' + asciiLogoString('single')
  ].join('\n'))
  .option('-v, --version', 'output the version number', PackageVersion)
  .action(() => {
    console.log(PackageVersion);
    process.exit(0);
  });

// @TODO
commandBin.command('start')
  .summary('subcmd to start the lsp using stdin/stdout')
  .description('start the language server for a connection to a client')
  .action(() => {
    // if (require.main === module) {
    //     startServer();
    // }
    startServer();
  });

commandBin.command('mini')
  .summary('subcmd to start the lsp using stdin/stdout with minimal indexing')
  .description('start the language server for a connection to a client with minimal indexing')
  .action(() => {
    // const startupConfig = 
    startServer();
  });

commandBin.command('capabilities')
  .summary('show the capabilities of the language server')
  .description('current capabilities of fish-lsp')
  .action(() => {
    console.log(asciiLogoString('large'));
    console.log(BuildCapabilityString());
    process.exit(0);
  });

commandBin.command('show-path')
  .summary('show the path of fish-lsp')
  .option('--bin', 'show the path of the fish-lsp executable')
  .option('--repo', 'show the path of the entire fish-lsp repo')
  .action(args => {
    let logPath = args.bin ? PathObj.bin : PathObj.repo;
    let wpath = args.bin ? 'BINARY' : 'REPOSITORY';
    console.log(wpath + ' ' + asciiLogoString('single'));
    console.log(logPath);
    process.exit(0);
  });

// @TODO
commandBin.command('startup-configuration')
  .usage('[option]')
  .option('--coc-json', 'show coc-settings.json output')
  .option('--vscode', 'show vscode-settings.json output')
  .option('--neovim', 'show neovim *.lua output')
  .summary('show the json/lua configurations for the language server')
  .description('show the lua/json configurations for the language server')
  .action(args => {
    if (args.cocJson) {
      console.log('coc-settings.json');
    } else if (args.vscode) {
      console.log('vscode-settings.json');
    } else if (args.neovim) {
      console.log('neovim *.lua');
    } else {
      console.log('no option selected, coc-settings.json is default');
    }
    process.exit(0);
  });

// @TODO
commandBin.command('time')
  .usage('--root-dir <dir>')
  .requiredOption('--root-dir <dir>', 'root directory of the fish project')
  .summary('time the fish-lsp server startup time to index the project files')
  .action(args => {
    const startTimer = Date.now();
    if (args.rootDir) {
    }
    console.log(Date.now());
  });

commandBin.command('contribute')
  .summary('see the fish-lsp github repo')
  .action(() => {
    console.log(asciiLogoString('normal'));
    console.log(RepoUrl);
    process.exit(0);
  });

commandBin.command('report')
  .summary('report an issue to the fish-lsp github repo')
  .action(() => {
    console.log(asciiLogoString('normal'));
    console.log(RepoUrl + '/issues');
    process.exit(0);
  });

commandBin.command('lsp-version')
  .usage('lsp-version')
  .summary('show the version of the language server protocol')
  .description('show the version of the language server protocol')
  .action(() => {
    console.log(asciiLogoString('single') + '\n');
    console.log('LSP version: ', PackageLspVersion);
    process.exit(0);
  });

commandBin.command('show-env')
  .usage('show-env')
  .summary('show all the environment variables used by the lsp in current shell')
  .description('show the environment variables of the language server')
  .action(() => {
    console.log('Environment Variables: ' + asciiLogoString('single'));
    console.log(GetEnvVariablesUsed());
    process.exit(0);
  });

// @TODO
commandBin.command('complete')
  .summary('generate completions file for ~/.config/fish/completions')
  .description('copy completions output to fish-lsp completions file')
  .action(() => {
    commandBin.commands.forEach((cmd: Command) => {
      console.log(`${cmd.name()}\t${cmd.summary()}`);
    });
    process.exit(0);

  });

// add flags to disable options for subcommands
const connectableSubcommands: string[] = [ 'start', 'mini' ];
commandBin.commands.forEach(subcmd => {
  if (connectableSubcommands.includes(subcmd.name())) {
    disableOptions.forEach(opt => {
      subcmd.option(opt.flag)
        .description(opt.description)
        .action(opt.action);
    });
  }
});

commandBin.parse();