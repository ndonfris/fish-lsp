import path from 'path';
import PackageJSON from '../../package.json';
// import PackageJSON from '@package';
import command, { Command, createCommand, createOption, Option } from 'commander';
import deepmerge from 'deepmerge';
import { ConfigManager } from 'src/configManager';
import { homedir } from 'os';
// const logo = BuildAsciiLogo()

export const program: command.Command = createCommand('fish-language-server')
    .version(PackageJSON.version, '-v, --version', 'output the current version')
    .description(PackageJSON.description)
    .argument('<subcommand>')

    // .option('-o, --startup-options <json>', 'show startup options', (json: string) => {
    //     console.log('startup options');
    //     console.log(JSON.stringify(json), null, 2);
    // })
    // .option('-t, --time <workspace>', 'time workspace index startup', () => {
    //     console.log('time taken to index workspace');
    // })
    // .option('--lsp-version', 'show language server protocol version', () => {
    //     console.log('LSP version: ', PackageJSON.dependencies['vscode-languageserver-protocol']!.toString());
    // 
    // })
    // .option('--disable-ascii-art', 'disable ascii art', () => {
    //     console.log('ascii art disabled');
    // })
    // .argument('<subcmd>', 'subcommand to run');


export function shortHelp(program: Command) {
  return [
    `${program.name()} <subcommand> [options]`,
    '',
    program.description(),
    '',
    `run '${program.name()} --help' for more information on a command.`
  ].join('\n');
}


// const cmdOptions: Option[] = [ 
//     new Option('-o, --startup-options <json>', 'show startup options'), 
//     new Option('-t, --time <workspace>', 'time workspace index startup'),
//     new Option('--lsp-version', 'show language server protocol version'),
//     new Option('--disable-ascii-art', 'disable ascii art'),
//     new Option('--disable-logging', 'disable logging'),
//     new Option('--disable-snippets', 'disable snippets support'),
//     new Option('--disable-formatting', 'disable formatting support'),
//     new Option('--disable-completion', 'disable completion support'),
//     new Option('--disable-hover', 'disable hover support'),
//     new Option('--disable-rename', 'disable rename support'),
//     new Option('--disable-definition', 'disable definition support'),
//     new Option('--disable-references', 'disable references support'),
//     new Option('--disable-diagnostics', 'disable diagnostics support'),
//     new Option('--disable-signatureHelp', 'disable signatureHelp support'),
//     new Option('--disable-codeAction', 'disable codeAction support'),
//     new Option('--no-index', 'disable indexing'),
//     new Option('--build-cache', 'build cache'),
//     new Option('--use-cache', 'use cache'),
// ]
// cmdOptions.forEach(opt => {
//     program.addOption(opt);
// })
// const p = program
//     .option('-o, --startup-options <JSON>', 'provide JSON startup configuration', (json: string) => {
//         console.log('startup options');
//         console.log(JSON.stringify(json), null, 2);
//     })
//     .option('-t, --time <workspace>', 'time workspace index startup', () => {
//         console.log('time taken to index workspace');
//     })
//     .option('-l, --lsp-version', 'show language server protocol version', () => {
//         console.log(asciiLogoString('single')+'\n');
//         console.log('LSP version: ', PackageJSON.dependencies['vscode-languageserver-protocol']!.toString());
//         process.exit(0);
//     })
    // .storeOptionsAsProperties();
type tToggleOption = {
    enable: boolean;
}

interface iToggleOptions extends tToggleOption {
    [key: string]: any;
}

const startupConfig: {
    [key: string]: iToggleOptions
} = {
        completion: {
            enable: true,
            triggerCharacters: ['.'],
            expandAbbreviations: true,
        },
        hover: {
            enable: true,
        },
        rename: {
            enable: true,
        },
        formatting: {
            enable: true,
            indent: 2,
            tabSize: 2,
            addSemis: true,
        },
        diagnostics: {
            enable: true,
            maxNumberOfProblems: 10,
        },
        references: {
            enable: true,
        },
        definition: {
            enable: true,
        },
        workspaces: {
            enable: true,
            symbols: {
                enable: true,
                max: 5000,
                prefer: 'functions',
            },
            paths: {
                defaults: [
                    `${homedir()}/.config/fish`,
                    '/usr/share/fish',
                ],
                allowRename: [
                    `${homedir()}/.config/fish`,
                ]
            },

        },
        codeActions: {
            enable: true,
            // create: {
            //     completionsFile: false,
            //     fromArgParse: false,
            // },
            // extract: {
            //     toPrivateFunction: false,
            //     toLocalVariable: false,
            // },
            // quickfix: {
            //     addMissingEnd: true,
            //     removeUnnecessaryEnd: true,
            // },
        },
        snippets: {
            enable: true,
        },
        logging: {
            enable: true,
        },
        asciiArt: {
            enable: true,
        },
        signatureHelp: {
            enable: true,
        },
        index: {
            enable: true,
        }
    }

class Config {
    
    constructor(
        public config: typeof startupConfig = deepmerge({}, startupConfig, {})
    ) {}
    //     this.config = config;
    // }
    
    public clearConfig() {
        for (const key of Object.keys(this.config)) {
            if (this.config[key] && this.config[key]?.enable !== undefined) {
                this.config[key]!.enable = false;
            }
        }
    }

    public mergePreferences(prefs: typeof startupConfig) {
        this.config = deepmerge(this.config, prefs);
    }
    
    public getConfig() {
        return this.config;
    }

    set enable(option: string) {
        if (this.config[option]) {
            this.config[option]!.enable = true;
        }
    }

    set disable(option: string) {
        if (this.config[option]) {
            this.config[option]!.enable = false;
        }
    }
}

const config = new Config();

function buildBothToggleOptions(flag: string, description: string): toggleOption[] {
    return [
        createToggleOption(`--enable-${flag}`, `enables ${description}`, () => {
            console.log(`${description} enabled`);
            config.enable = flag;

        }),
        createToggleOption(`--disable-${flag}`, `disables ${description}`, () => {
            console.log(`${description} enabled`);
            config.disable = flag;
        }),
    ]
}

function createToggleOption(flag: string, description: string, action: () => void): toggleOption {
    return {
        flag,
        description,
        action
    } as toggleOption;
}

export type toggleOption = {
    flag: string;
    description: string;
    action: (() => void);
}

// export const disableOptions: DisableOption[]  = [
//     createDisableOption('--disable-asciiArt', 'disable ascii art', () => {
//         console.log('ascii art disabled');
//     }),
//     createDisableOption('--disable-logging', 'disable logging', () => {
//         console.log('logging disabled');
//     }),
//     createDisableOption('--disable-snippets', 'disable snippets support', () => {
//         console.log('snippets support disabled');
//     }),
//     createDisableOption('--disable-formatting', 'disable formatting support', () => {
//         console.log('formatting support disabled');
//     }),
//     createDisableOption('--disable-completion', 'disable completion support', () => {
//         console.log('completion support disabled');
//     }),
//     createDisableOption('--disable-hover', 'disable hover support', () => {
//         console.log('hover support disabled');
//     }),
//     createDisableOption('--disable-rename', 'disable rename support', () => {
//         console.log('rename support disabled');
//     }),
//     createDisableOption('--disable-definition', 'disable definition support', () => {
//         console.log('definition support disabled');
//     }),
//     createDisableOption('--disable-references', 'disable references support', () => {
//         console.log('references support disabled');
//     }),
//     createDisableOption('--disable-diagnostics', 'disable diagnostics support', () => {
//         console.log('diagnostics support disabled');
//     }),
//     createDisableOption('--disable-signatureHelp', 'disable signatureHelp support', () => {
//         console.log('signatureHelp support disabled');
//     }),
//     createDisableOption('--disable-codeAction', 'disable codeAction support', () => {
//         console.log('codeAction support disabled');
//     }),
//     createDisableOption('--disable-index', 'disable indexing', () => {
//         console.log('indexing disabled');
//     })
// ]
export const toggleOptions: toggleOption[]  = [
    ...buildBothToggleOptions('ascii-art', 'ascii art'),
    ...buildBothToggleOptions('logging', 'logging'),
    ...buildBothToggleOptions('snippets', 'snippets support'),
    ...buildBothToggleOptions('formatting', 'formatting support'),
    ...buildBothToggleOptions('completion', 'completion support'),
    ...buildBothToggleOptions('hover', 'hover support'),
    ...buildBothToggleOptions('rename', 'rename support'),
    ...buildBothToggleOptions('definition', 'definition support'),
    ...buildBothToggleOptions('references', 'references support'),
    ...buildBothToggleOptions('diagnostics', 'diagnostics support'),
    ...buildBothToggleOptions('signatureHelp', 'signatureHelp support'),
    ...buildBothToggleOptions('codeAction', 'codeAction support'),
    ...buildBothToggleOptions('index', 'indexing')
]

export function optionsStringEqualsRaw(optionValue: string, rawValue: string) {

    const removeToggleString = (toggle: string, str: string) => {
        const removedToggle = str.replace(`--${toggle}-`, '');
        return removedToggle.at(0)?.toUpperCase() + removedToggle.slice(1);
    }

    const disableFixed = removeToggleString('disable', rawValue);
    const enabledFixed = removeToggleString('enable', rawValue);
    return (
        disableFixed === optionValue ||
        enabledFixed === optionValue ||
        rawValue === optionValue 
    );
}


export const toggleOptionsMap = (): Map<string, toggleOption> => {
    const result = new Map<string, toggleOption>()
    toggleOptions.forEach((opt: toggleOption) => {
        result.set(opt.flag, opt);
    })
    return result;
}




// p.parse(process.argv);

// program
//     .argument('<subcmd>', 'subcommand to run')
//     .argument('option', 'option to run');

// program.option('-o, --startup-options <json>', 'show startup options', (json: string) => {
//     console.log(JSON.stringify(json), null, 2);
// })
// program.option('-t, --time <workspace>', 'time workspace index startup', (workspace) => {
//     console.log(`time taken to index ${workspace}`)
// })
// program.option('--lsp-version', 'show language server protocol version', () => {
//     console.log('LSP version: ', PackageJSON.dependencies['vscode-languageserver-protocol']!.toString());
// })
// program.option('--disable-ascii-art', 'disable ascii art', () => {
//     console.log('ascii art disabled');
// })
// program.option('--disable-logging', 'disable logging', () => {
//     console.log('logging disabled');
// })
// program.option('--disable-snippets', 'disable snippets support', () => {
//     console.log('snippets support disabled');
// })
// program.option('--disable-formatting', 'disable formatting support', () => {
//     console.log('formatting support disabled');
// })
// program.option('--disable-completion', 'disable completion support', () => {
//     console.log('completion support disabled');
// })
// program.option('--disable-hover', 'disable hover support', () => {
//     console.log('hover support disabled');
// })
// program.option('--disable-rename', 'disable rename support', () => {
//     console.log('rename support disabled');
// })
// program.option('--disable-definition', 'disable definition support', () => {
//     console.log('definition support disabled');
// })
// program.option('--disable-references', 'disable references support', () => {
//     console.log('references support disabled');
// })
// program.option('--disable-diagnostics', 'disable diagnostics support', () => {
//     console.log('diagnostics support disabled');
// })
// program.option('--disable-signatureHelp', 'disable signatureHelp support', () => {
//     console.log('signatureHelp support disabled');
// })
// program.option('--disable-codeAction', 'disable codeAction support', () => {
//     console.log('codeAction support disabled');
// })
// program.option('--no-index', 'disable indexing', () => {
//     console.log('indexing disabled');
// })
// program.option('--build-cache', 'build cache', () => {
//     console.log('building cache');
// })
// program.option('--use-cache', 'use cache', () => {
//     console.log('using cache');
// })
//
// program.showHelpAfterError(shortHelp(program));

// .option('-h, --help', 'display help for command')
// program.usage('<subcommand> [options]')
// console.log(JSON.stringify(program.opts()))


    


type CommandKey = string;
type CommandValue = {
  summary: string;
  action: (...args: any[]) => void;
  help?: string;
  aliases?: string[];
  opts?: Option[];
  isDefault?: boolean;
  completion?: string;
}
export type CommandMapType = Map<CommandKey, CommandValue>;

export const commandMap: CommandMapType = new Map([
  // ['start', {
  //   summary: 'Start the project',
  //   action: (opt: string = '--stdio') => {
  //   }
  // }],
  ['complete', {
    summary: 'build completions',
    action: () => {
      console.log(`completion\'s for ${program.name().toString()}`)
      commandMap.forEach((value, key) => {
        // console.log(key+'\t'+value.description)
        console.log(`complete -c fish-language-server -a ${key} '${value.summary}'`);
            });
        // console.log(JSON.stringify(program.storeOptionsAsProperties(), null, 2));
            // program.optsWithGlobals().forEach((opt: Option) => {
            // program.
            // .forEach((opt: Option) => {
            //     console.log(opt);
            //   })
            // .forEach((opt: Option) => {
            //   let {short = '- ', long = '--', description} = opt
            //   short = short?.slice(1) || '';
            //   long = long?.slice(2) || '';
            //   if (!!short && !!long) {
            //       console.log(`complete -c fish-language-server -s ${short} -l ${long} '${description}'`);
            //   } else if (short && !long) {
            //       console.log(`complete -c fish-language-server -s ${short} '${description}'`);
            //   } else if (!short && long) {
            //       console.log(`complete -c fish-language-server -l ${long} '${description}'`);
            //   }
            // })
        }
    }],
    ['capabilities', {
        summary: 'list capabilities',
        action: () => {
            const headerString: string = `Capabilities for ${PackageJSON.name} version ${PackageJSON.version}`;
            console.log(asciiLogoString('large'));
            console.log('-'.repeat(headerString.length));
            console.log(headerString);
            console.log('-'.repeat(headerString.length));
            // console.log(BuilCapabilityString());
        }
    }],
    ['show-startup-options', {
        summary: 'show startup options',
        action: () => {
            const options = JSON.stringify({
                "filetypes": ["fish"],
                "startupOptions": ["start"],
                "completion": {
                    "enable": "true",
                    "triggerCharacters": ["."],
                    "expandAbbreviations": "true",
                },
                "formatting": {
                    "enable": "true",
                    "indent": "2",
                    "tabSize": "2",
                    "addSemis": "true",
                }
            })
            console.log(options);
        }
    }],
    ['report', {
        summary: 'report an issue',
        action: () => {
            console.log(asciiLogoString('normal'), '\n');
            console.log(PackageJSON.repository?.url.slice(0, -4)+'/issues');
        }
    }],
    ['contribute', {
        summary: 'contribute to the project',
        action: () => {
            console.log(asciiLogoString('normal'), '\n');
            console.log(PackageJSON.repository?.url.slice(0, -4));
        }
    }],
    ['show-path', {
        summary: 'path to the language server repo',
        action: () => {
            console.log(asciiLogoString('normal'), '\n');
            console.log(path.resolve('..', __dirname.toString(),  '..','cli.js'));
        }
    }]
]);

function AddCommandsToProgram() {
    commandMap.forEach((value, key) => {
        // console.log(`key: ${key}`);
        // console.log('value', value);
        // console.log('value', JSON.stringify(value, null, 2));
        const { opts, isDefault, action } = value;
    // const extraCmdArgs = !!isDefault ? { isDefault: true } : {};
    const cmd = createCommand(key)
      .description(value.summary)
      .action(action)
      
    opts?.forEach(opt => {
      cmd.addOption(opt)
    })
    
    program.addCommand(cmd)
  });
}

AddCommandsToProgram();
program.enablePositionalOptions(true)


/// HELPERS
export function BuildCapabilityString() {
    const done: string = '✔️ ';
    const todo: string = '❌';
    // const done: string = '✅'
    // const todo: string = '❌'
    const statusString = [
        `${done} complete`,
        `${done} hover`,
        `${done} rename`,
        `${done} definition`,
        `${done} references`,
        `${todo} diagnostics`,
        `${todo} signatureHelp`,
        `${todo} codeAction`,
        `${todo} codeLens`,
        `${done} documentLink`,
        `${done} formatting`,
        `${done} rangeFormatting`,
        `${todo} refactoring`,
        `${todo} executeCommand`,
        `${done} workspaceSymbol`,
        `${done} documentSymbol`,
        `${done} foldingRange`,
        `${done} fold`,
        `${done} onType`,
        `${done} onDocumentSaveFormat`,
        `${done} onDocumentSave`,
        `${done} onDocumentOpen`,
        `${done} onDocumentChange`
    ].join('\n');
  return statusString;
}

export function buildAsciiLogo() {
  return parseInt(process.env['COLUMNS']?.toString() || '100') >= 30 ? asciiLogoString('large') : asciiLogoString('normal');
}

// ASCII ART
export function asciiLogoString(size: 'normal' | 'large' | 'single' = 'normal') {
  switch (size) {
    case 'normal':
      return [
        '      LSPLSPLSP        P    ███████╗██╗███████╗██╗  ██╗    ██╗     ███████╗██████╗ ',
        '    LSPLSPLSPLSP     LSP    ██╔════╝██║██╔════╝██║  ██║    ██║     ██╔════╝██╔══██╗',
        '  LSP   LSPLSPLSP  LSPLS    █████╗  ██║███████╗███████║    ██║     ███████╗██████╔╝',
        'LSPLSPLSPLS  SPLSPLSPLSP    ██╔══╝  ██║╚════██║██╔══██║    ██║     ╚════██║██╔═══╝ ',
        '  LSPLSPLSP  PLSP  LSPLS    ██║     ██║███████║██║  ██║    ███████╗███████║██║     ',
        '    LSPLSPLSPLSP     LSP    ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝    ╚══════╝╚══════╝╚═╝     ',
        '      LSPLSPLSP        P                                                           ' 
      ].join('\n');
    case 'large':
      return  [
        '                                           LSP LSP LSP LSP                  ',
        '                                         LSP LSP LSP LSP LSP                ',
        '  ███████╗██╗███████╗██╗  ██╗          LSP LSP LSP LSP LSP LSP              ', 
        '  ██╔════╝██║██╔════╝██║  ██║         LSP     LSP LSP LSP LSP LSP           ',
        '  █████╗  ██║███████╗███████║        LSP       LSP LSP LSP LSP LSP      LSP ',
        '  ██╔══╝  ██║╚════██║██╔══██║       LSP LSP LSP LSP LSP     LSP LSP LSP LSP ',
        '  ██║     ██║███████║██║  ██║           LSP LSP LSP         LSP LSP LSP LSP ',
        '  ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝               LSP             LSP LSP LSP LSP ',
        '   ██╗     ███████╗██████╗                  LSP LSP         LSP LSP LSP LSP ',
        '   ██║     ██╔════╝██╔══██╗                 LSP LSP LSP     LSP LSP LSP LSP ',
        '   ██║     ███████╗██████╔╝            LSP LSP LSP LSP LSP LSP LSP  LSP LSP ',
        '   ██║     ╚════██║██╔═══╝          LSP LSP LSP LSP LSP LSP LSP LSP     LSP ',
        '   ███████╗███████║██║               LSP LSP LSP LSP LSP LSP LSP            ',
        '   ╚══════╝╚══════╝╚═╝                 LSP LSP LSP LSP LSP LSP              ',
        '                                         LSP LSP LSP LSP LSP                '
      ].join('\n')
    case 'single':
    default:
      return '><(((°> FISH LSP'
  }

}

export const logoText = buildAsciiLogo();
export const RepoUrl = PackageJSON.repository?.url.slice(0, -4);
export const PackageVersion = PackageJSON.version;


export const PathObj: {[K in 'bin' | 'root' | 'repo']: string} = {
    ['bin']: path.resolve('..', __dirname.toString(),  '..','cli.js'),
    ['root']: path.resolve(__dirname, '..', '..'),
    ['repo']: path.resolve(__dirname, '..', '..'),
}

export const PackageLspVersion = PackageJSON.dependencies['vscode-languageserver-protocol']!.toString();

export const GetEnvVariablesUsed = () => {
    const envVars = process.env;
    const envKeys = Object.keys(envVars);
    const envValues = Object.values(envVars);
    const fish_env_variables_used: string[] = [
        'FISH_PATH',
        'FISH_LSP_PATH',
        'FISH_LSP_VERSION',
        'FISH_LSP_LOGGING',
        'FISH_LSP_EXE',
        'fish_function_dir',
        'fish_complete_path',
    ]
    const resultKeys: string[] = envKeys.filter((key) => fish_env_variables_used.includes(key))
    const DEEP_COPY_RESULT = deepmerge({}, process.env)
    for (const [k,v] of Object.entries(DEEP_COPY_RESULT)) {
        if (!resultKeys.includes(k)) {
            delete DEEP_COPY_RESULT[k]
        }
    }
    
    return DEEP_COPY_RESULT;
}


// return [ 
//   '           L S P L S P L S P L ',
//   '       P L S P L S P L S P L S P        L ',
//   '    S P   L S P L S P L S P L S P     L S ',
//   '  P L S   P L S P L S P L S P L S    P L S',
//   'S P L S P L S P L S P L S P L S P   L S P ',
//   '  L S P L S P L S P L S P L S P L  S P L S',
//   '      P L S P L S P L S P L S P L S P L S P',
//   '  S P L S P L S P L S P L S P L S  P L S P',
//   'P L S P L S P L S P L S P L S P L    S P L',
//   '  S P L S P L S P L S P L S P L       S P',
//   '    S P L S P L S P L S P L S P        L S',
//     '       P L S P L S P L S P L            S',
//     '         L S P L S P L S P' 
//   ].join('\n');