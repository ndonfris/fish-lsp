#!/usr/bin/env node
//'use strict'
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from "vscode-languageserver/node";
import { Argument, Command, Option } from 'commander';
import FishServer from './server';
import * as luaJson from 'lua-json';
import { asciiLogoString, BuildCapabilityString, RepoUrl, PathObj, PackageLspVersion, GetEnvVariablesUsed, PackageVersion, toggleOptions, toggleOptionsMap } from './utils/commander-cli-subcommands';


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
  .storeOptionsAsProperties()
  .configureHelp({helpWidth: 100})
  .addHelpText('beforeAll', asciiLogoString('large') + '\n')
  .addHelpText('afterAll', [
      '________________________________________',
      'authored by: https://github.com/ndonfris',
      '     ' + asciiLogoString('single')
  ].join('\n'))
  .enablePositionalOptions(true)
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
  .description([
        'Start the language server for a connection to a client with minimal indexing.',
        'This is useful for large projects, where indexing can take a long time.',
        'Also useful for running `edit_command_buffer` (editing prompt in tmp file).',
    ].join(' '))
  .action(() => {
    // const startupConfig = 
    startServer();
  });



commandBin.command('min [TOGGLE...]')
  .summary('run barebones startup config')
  .description([
      'Initialize the fish-lsp with a completely minimal startup configuration.',
      'This is useful for running the language server with minimal indexing, debugging specific features',
      'and various other edge cases where the full feature set is not needed.'
   ].join('\n'))
  .option('--show', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    `STRINGS FOR '--enable/--disable':`,
    `(${toggleOptions.map((opt, index) => {
      return index < toggleOptions.length - 1 && index > 0 && index % 5 == 0 ? `${opt.flag},\n` :
        index < toggleOptions.length - 1 ? `${opt.flag},` :
          opt.flag;
    }).join(' ')})`,
    '',
    'Examples:' ,
    '\tfish-lsp min --enable hover  # only enable the hover feature',
    `\tfish-lsp min --enable all    # works like the 'start' subcommand`,
    `\tfish-lsp min --enable all --disable logging completion codeAction`,
  ].join('\n'))
  .action(() => {
    /**
      * Accumulate the arguments into two arrays, '--enable' and '--disable'
      * More than one enable/disable flag can be used, but the output will be
      * the stored across two resulting arrays (if both flags have )
      */
    const [enabled, disabled]: [string[], string[]] = [[],[]] 
    let current: string[];
    commandBin.args.forEach(arg => {
      if (['--enable', '--disable'].includes(arg)) {
        if (arg === '--enable') current = enabled;
        if (arg === '--disable') current = disabled;
        return
      } 
      if (['-h', '--help', 'help'].includes(arg)) {
        commandBin.commands.find(command => command.name() === 'min')!.outputHelp();
        process.exit(0);
      }
      if (['-s', '--show'].includes(arg)) {
        console.log("SEEN SHOW COMMAND! dumping...");
        console.log({enabled, disabled});
        process.exit(0);
      }
      if (current) current?.push(arg);
    })
    console.log({enabled, disabled});
    process.exit(0);
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
// .option('--vscode', 'show vscode-settings.json output')
commandBin.command('startup-configuration')
  .usage('[language-option]')
  .summary('show the json/lua configurations for the language server')
  .description('show the lua/json configurations for the language server')
  .option('--json', 'show coc-settings.json output')
  .option('--lua', 'show neovim *.lua output')
  .action(args => {
    if (args.json) {
      console.log('coc-settings.json');
      console.log(JSON.stringify({'hello': "world"}, null, 2));
    // } else if (args.vscode) {
    //   console.log('vscode-settings.json');
    //   console.log(JSON.stringify({"todo" : [1, 2, 3], 'hello': "world"}, null, 2));
    } else if (args.lua) {
      const jsonConf = JSON.parse(JSON.stringify({"todo" : [1, 2, 3], 'hello': "world"}))
      console.log('neovim *.lua');
      console.log(luaJson.format(jsonConf));
    } else {
      console.log('no option selected, coc-settings.json is default');
    }
    process.exit(0);
  })

// @TODO
commandBin.command('time')
  .usage('--path [dir]')
  .summary('time the fish-lsp server startup time to index the project files')
  .requiredOption('--path [dir]', 'root directory of the fish project')
  .action(args => {
    const startTimer = Date.now();
    if (args.rootDir) {
    }
    const endTimer = Date.now();
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

// add flags to disable options for subcommands
const connectableSubcommands: string[] = [ 'start', 'mini' ];
// const toggleOptions: string[] = [ '--disable', '--enable' ];
const completionString: string[] = []
commandBin.commands.forEach(subcmd => {
  if (connectableSubcommands.includes(subcmd.name())) {
    // connectableSubcommands.forEach(subcmd => {
    // subcmd.option('--disable [configKey...]', 'disable the subcommand', )
    // subcmd.option('--enable', 'enable the subcommand');
    toggleOptions.forEach((opt) => {
      subcmd.option(opt.flag)
        .description(opt.description)
        .action(opt.action);
    });
  }
});

// @TODO
commandBin.command('complete')
  .summary('generate completions file for ~/.config/fish/completions')
  .description('copy completions output to fish-lsp completions file')
  .action(() => {
    commandBin.commands.forEach((cmd: Command) => {
      console.log(`${cmd.name()}\t${cmd.summary()}`);
      if (Object.keys(cmd.opts()).length > 0) {
        Object.keys(cmd.opts()).forEach(opt => {
          console.log('\t'+opt)
        })
      }

      // for (const [k, v] of toggleOptionsMap().entries()) {
      //   console.log(`\t${k}\t${JSON.stringify(v)}`);
      // }
      // console.log(Object.keys(cmd.optsWithGlobals()))
      // cmd?.options!.forEach((opt: any) => {
      //   console.log(opts);
      // })
      // Object.entries( cmd.opts() ).map((k: string, opt: Option) => {
      //   console.log(`${opt.flags}\t${opt.description}`);
      // })
    })
    process.exit(0);
  });



commandBin.parse();
console.log(commandBin.opts());