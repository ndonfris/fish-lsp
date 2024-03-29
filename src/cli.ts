#!/usr/bin/env node
//'use strict'
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter } from "vscode-languageserver/node";
import { Argument, Command, Option } from 'commander';
import FishServer from './server';
import * as luaJson from 'lua-json';
import { asciiLogoString, BuildCapabilityString, RepoUrl, PathObj, PackageLspVersion, GetEnvVariablesUsed, PackageVersion, accumulateStartupOptions } from './utils/commander-cli-subcommands';
import { mainStartupManager, bareStartupManger, ConfigMap } from './utils/configuration-manager';


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

export function startWebscoket() {
  // Create a connection for the server.
  // The connection uses stdin/stdout for communication.
  const connection = createConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout)
  );
  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
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
    .configureHelp({helpWidth: 100})
    .showSuggestionAfterError()
    .showHelpAfterError()
    .addHelpText('beforeAll', asciiLogoString('large') + '\n')
    .addHelpText('afterAll', [
        "",
        "Examples:",
        "  # Default setup, with all options enabled",
        "  > fish-lsp start ",
        "",
        "  # Enable only the hover provider:",
        "  > fish-lsp bare --enable hover",
        "",
        "  # Generate and store completions file:",
        "  > fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish",
        ""
    ].join('\n'))

    // .configureHelp(help=> {
    //         help.
    //     })
    // .storeOptionsAsProperties();
    
  return bin;
};

export const commandBin = createFishLspBin()
    // .storeOptionsAsProperties()
  // .storeOptionsAsProperties()
  // .configureHelp({helpWidth: 100})
  // .addHelpText('beforeAll', asciiLogoString('large') + '\n');
  // .addHelpText('afterAll', [
  //     '________________________________________',
  //     'authored by: https://github.com/ndonfris',
  //     '     ' + asciiLogoString('single')
  // ].join('\n'))
  // .option('-v, --version', 'output the version number', PackageVersion)
  // .action(args => {
  //   if (args.version) {
  //       console.log(PackageVersion);
  //       process.exit(0);
  //   }

  // });

// @TODO
commandBin.command('start [TOGGLE...]')
  .summary('subcmd to start the lsp using stdin/stdout')
  .description('start the language server for a connection to a client')
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    `STRINGS FOR '--enable/--disable':`,
    `(${ConfigMap.configNames.map((opt, index) => {
      return index < ConfigMap.configNames.length - 1 && index > 0 && index % 5 == 0 ? `${opt},\n` :
        index < ConfigMap.configNames.length - 1 ? `${opt},` : opt;
    }).join(' ')})`,
    '',
    'Examples:' ,
    '\tfish-lsp start --disable hover  # only disable the hover feature',
    `\tfish-lsp start --disable completion logging index hover --show`,
    `\tfish-lsp start --enable --disable logging completion codeAction`,
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



commandBin.command('min [TOGGLE...]')
  .alias('bare')
  .alias('minimal')
  .summary('run barebones startup config')
  .description([
      'Initialize the fish-lsp with a completely minimal startup configuration.',
      'This is useful for running the language server with minimal indexing, debugging specific features',
      'and various other edge cases where the full feature set is not needed.'
   ].join('\n'))
  .option('--dump', 'stop lsp & show the startup options being read')
  .option('--enable <string...>', 'enable the startup option')
  .option('--disable <string...>', 'disable the startup option')
  .addHelpText('afterAll', [
    '',
    `STRINGS FOR '--enable/--disable':`,
    `(${ConfigMap.configNames.map((opt, index) => {
      return index < ConfigMap.configNames.length - 1 && index > 0 && index % 5 == 0 ? `${opt},\n` :
        index < ConfigMap.configNames.length - 1 ? `${opt},` : opt;
    }).join(' ')})`,
    '',
    'Examples:' ,
    '\tfish-lsp min --enable hover  # only enable the hover feature',
    // `\tfish-lsp min --enable all    # works like the 'start' subcommand`,
    `\tfish-lsp min --enable all --disable logging completion codeAction`,
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
// const toggleOptions: string[] = [ '--disable', '--enable' ];
// connectableSubcommands.forEach(subcmd => {
// subcmd.option('--disable [configKey...]', 'disable the subcommand', )
// subcmd.option('--enable', 'enable the subcommand');
/** **************************************************************** */
/** **************************************************************** */
/** **************************************************************** */
// const connectableSubcommands: string[] = [ 'start', 'mini' ];
// const completionString: string[] = []
// commandBin.commands.forEach(subcmd => {
//   if (connectableSubcommands.includes(subcmd.name())) {
//     toggleOptionNames.forEach((opt) => {
//       subcmd.option(opt)
//         .description(opt.description)
//         .action(opt.action);
//     });
//   }
// });

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
      commandBin.commands.forEach(cmd => {
        console.log(cmd.name()+'\t'+cmd.summary());
      })
    } else if (args.toggles) {
      commandBin.commands.forEach(cmd => {
        console.log(cmd.name()+'\t'+cmd.summary());
        Object.entries(cmd.opts()).forEach(opt => {
          console.log('--'+opt[0])
        })

      })
    } else if (args.fish) {
      // firefox-dev https://github.com/fish-shell/fish-shell/blob/master/share/completions/cjxl.fish
      const subcmdStrs = commandBin.commands.map(cmd => `${cmd.name()}\\t'${cmd.summary()}'`).join('\n');
      console.log('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
      console.log('complete -c fish-lsp -f', '\n');
      console.log('complete -c fish-lsp -n "__fish_use_subcommand" -a "\n'+subcmdStrs+'\"');
      // console.log('complete -c fish-lsp -n "__fish_seen_subcommand_from start" -a "show --enable --disable"');
      console.log('\nset __fish_lsp_subcommands bare min start\n');
      console.log('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -a \"\n',
        [
          `--show\\t'dump output and stop server'`,
          `--enable\\t'enable feature'`,
          `--disable\\t'disable feature'\"`, 
          ''
        ].join('\n'));
      console.log('complete -c fish-lsp -n "__fish_seen_subcommand_from startup-configuration" -a \"\n',
        [
          `--json\\t'show coc-settings.json output'`,
          `--lua\\t'show neovim *.lua output'\"`, 
          ''
        ].join('\n'));
      console.log('complete -c fish-lsp -n "__fish_seen_subcommand_from complete" -a \"\n',
        [
          `--names\\t'show the feature names of the completions'`,
          `--toggles\\t'show the feature names of the completions'`,
          `--fish\\t'show fish script'`,
          `--features\\t'show features'\"`, 
          ''
        ].join('\n'));

      console.log('complete -c fish-lsp -n "__fish_seen_subcommand_from show-path" -a \"\n',
        [
          `--bin\\t'show bin'`,
          `--repo\\t'show repo'\"`, 
          ''
        ].join('\n'));

      console.log('function _fish_lsp_get_features')
      // console.log('    fish-lsp complete --features')
      console.log('    printf %b\\n ', ConfigMap.configNames.join(' '))

      console.log('end\n')

      console.log('# COMPLETION: fish-lsp subcmd <option> [VALUE] (`fish-lsp start --enable ...`)')
      console.log('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l enable -xa \'(_fish_lsp_get_features)\'')
      console.log('complete -c fish-lsp -n \'__fish_seen_subcommand_from $__fish_lsp_subcommands\' -l disable -xa \'(_fish_lsp_get_features)\'')
      console.log('\n# cp ~/.config/fish/completions/fish-lsp.fish ~/.config/fish/completions/fish-lsp.fish.bak');
      console.log('# fish-lsp complete --fish > ~/.config/fish/completions/fish-lsp.fish');
    } else if (args.features) {
      ConfigMap.configNames.forEach(name => {
        console.log(name);
      })
    }
    process.exit(0);
  });



commandBin.parse();
