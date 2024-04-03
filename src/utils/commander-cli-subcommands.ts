import { readFileSync } from 'fs';
import { resolve } from 'path';
import PackageJSON from '../../package.json';
// import PackageJSON from '@package';
import deepmerge from 'deepmerge';
import { commandBin } from '../cli';
import { homedir } from 'os';
// const logo = BuildAsciiLogo()

// Base interface for simple enable/disable features
interface ConfigToggleOptionValue {
  enable: boolean;
}

// Extend the base interface for features with additional configuration
interface CompletionConfigOption extends ConfigToggleOptionValue {
  triggerCharacters: string[];
  expandAbbreviations: boolean;
}

interface FormattingConfigOption extends ConfigToggleOptionValue {
  indent: number;
  tabSize: number;
  addSemis: boolean;
}

interface DiagnosticsConfigOption extends ConfigToggleOptionValue {
  maxNumberOfProblems: number;
}

interface WorkspacesConfigOption extends ConfigToggleOptionValue {
  symbols: {
    enable: boolean;
    max: number;
    prefer: string;
  };
  paths: {
    defaults: string[];
    allowRename: string[];
  };
}

interface StartupConfig {
  completion: CompletionConfigOption;
  hover: ConfigToggleOptionValue;
  rename: ConfigToggleOptionValue;
  formatting: FormattingConfigOption;
  diagnostics: DiagnosticsConfigOption;
  references: ConfigToggleOptionValue;
  definition: ConfigToggleOptionValue;
  workspaces: WorkspacesConfigOption;
  codeActions: ConfigToggleOptionValue;
  snippets: ConfigToggleOptionValue;
  logging: ConfigToggleOptionValue;
  asciiArt: ConfigToggleOptionValue;
  signatureHelp: ConfigToggleOptionValue;
  index: ConfigToggleOptionValue;
  // Add an index signature for unknown properties
  [key: string]: ConfigToggleOptionValue | any;
}

// You can add more specific interfaces for other configurations as needed

const buildBareConfigValue = (key: string) => {
  switch (key) {
    case 'completion':
      return {
        enable: false,
        triggerCharacters: [],
        expandAbbreviations: false,
      };
    case 'hover':
    case 'rename':
    case 'definition':
    case 'references':
    case 'snippets':
    case 'logging':
    case 'asciiArt':
    case 'index':
    case 'signatureHelp':
      return {
        enable: false,
      };
    case 'formatting':
      return {
        enable: false,
        indent: 4,
        tabSize: 4,
        addSemis: false,
      };
    case 'diagnostics':
      return {
        enable: false,
        maxNumberOfProblems: 10,
      };
    case 'workspaces':
      return {
        enable: false,
        symbols: {
          enable: false,
          max: 5000,
          prefer: 'functions',
        },
        paths: {
          defaults: [],
          allowRename: [],
        },
      };
    default:
      return { enable: false };
  }
};

export const startupConfigEnabled: StartupConfig = {
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
      ],
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
  },
};

export const startupConfigDisabled: StartupConfig = {
  completion: {
    enable: false,
    triggerCharacters: [],
    expandAbbreviations: false,
  },
  hover: {
    enable: false,
  },
  rename: {
    enable: false,
  },
  formatting: {
    enable: true,
    indent: 4,
    tabSize: 4,
    addSemis: false,
  },
  diagnostics: {
    enable: false,
    maxNumberOfProblems: 10,
  },
  references: {
    enable: false,
  },
  definition: {
    enable: false,
  },
  workspaces: {
    enable: false,
    symbols: {
      enable: false,
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
      ],
    },

  },
  codeActions: {
    enable: false,
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
    enable: false,
  },
  logging: {
    enable: false,
  },
  asciiArt: {
    enable: false,
  },
  signatureHelp: {
    enable: false,
  },
  index: {
    enable: false,
  },
};

export function updateConfiguration<T>(path: string[], newValue: T, config: any): boolean {
  let current = config;

  // Navigate through the path except the last key
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];

    if (!key || current[key] === undefined) {
      // Handle undefined keys if necessary, e.g., by initializing them
      console.warn(`Key ${key} does not exist.`);
      return false; // Or handle as needed
    }
    current = current[key];
  }

  const lastKey = path[path.length - 1]!; // Correct way to access the last element
  // Now, use `lastKey` to access or update the final location in `current`
  if (Array.isArray(current[lastKey])) {
    if (!current[lastKey].includes(newValue)) {
      current[lastKey].push(newValue);
    } else {
      console.log(`Value ${newValue} already exists in ${lastKey}, not adding.`);
      return false;
    }
  } else {
    // Handle non-array `current[lastKey]`, such as setting a new value directly
    current[lastKey] = newValue;
  }
  return true;
}

// export function optionsStringEqualsRaw(optionValue: string, rawValue: string) {
//
//     const removeToggleString = (toggle: string, str: string) => {
//         const removedToggle = str.replace(`--${toggle}-`, '');
//         return removedToggle.at(0)?.toUpperCase() + removedToggle.slice(1);
//     }
//
//     const disableFixed = removeToggleString('disable', rawValue);
//     const enabledFixed = removeToggleString('enable', rawValue);
//     return (
//         disableFixed === optionValue ||
//         enabledFixed === optionValue ||
//         rawValue === optionValue
//     );
// }

/**
 * Accumulate the arguments into two arrays, '--enable' and '--disable'
 * More than one enable/disable flag can be used, but the output will be
 * the stored across two resulting arrays (if both flags have values as input).
 * Handles some of the default commands, such as '--help', and '-s, --show'
 * from the command line args.
 */
export function accumulateStartupOptions(args: string[]): {
  enabled: string[];
  disabled: string[];
  dumpCmd: boolean;
} {
  const [subcmd, ...options] = args;
  const [enabled, disabled]: [string[], string[]] = [[], []];
  let dumpCmd = false;
  let current: string[];
  options?.forEach(arg => {
    if (['--enable', '--disable'].includes(arg)) {
      if (arg === '--enable') {
        current = enabled;
      }
      if (arg === '--disable') {
        current = disabled;
      }
      return;
    }
    if (['-h', '--help', 'help'].includes(arg)) {
      commandBin.commands.find(command => command.name() === subcmd)!.outputHelp();
      process.exit(0);
    }
    if (['--dump'].includes(arg)) {
      console.log('SEEN SHOW COMMAND! dumping...');
      dumpCmd = true;
      return;
    }
    if (current) {
      current?.push(arg);
    }
  });
  return { enabled, disabled, dumpCmd };
}

/// HELPERS
export function BuildCapabilityString() {
  const done = '✔️ '; // const done: string = '✅'
  const todo = '❌'; // const todo: string = '❌'
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
    `${done} onDocumentChange`,
  ].join('\n');
  return statusString;
}

export function buildAsciiLogo() {
  return parseInt(process.env.COLUMNS?.toString() || '100') >= 30 ? asciiLogoString('large') : asciiLogoString('normal');
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
        '      LSPLSPLSP        P                                                           ',
      ].join('\n');
    case 'large':
      return [
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
        '                                         LSP LSP LSP LSP LSP                ',
      ].join('\n');
    case 'single':
    default:
      return '><(((°> FISH LSP';
  }
}

export const logoText = buildAsciiLogo();
export const RepoUrl = PackageJSON.repository?.url.slice(0, -4);
export const PackageVersion = PackageJSON.version;

export const PathObj: {[K in 'bin' | 'root' | 'repo' | 'manFile' | 'logsFile']: string} = {
  ['bin']:  resolve(__dirname.toString(), '..', '..', 'bin', 'fish-lsp'),
  ['root']: resolve(__dirname, '..', '..'),
  ['repo']: resolve(__dirname, '..', '..'),
  ['manFile']: resolve(__dirname, '..', '..', 'docs', 'man', 'fish-lsp.1'),
  ['logsFile']: resolve(__dirname, '..', '..', 'logs.txt'),
};

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
  ];
  const resultKeys: string[] = envKeys.filter((key) => fish_env_variables_used.includes(key));
  const DEEP_COPY_RESULT = deepmerge({}, process.env);
  for (const [k, v] of Object.entries(DEEP_COPY_RESULT)) {
    if (!resultKeys.includes(k)) {
      delete DEEP_COPY_RESULT[k];
    }
  }

  return DEEP_COPY_RESULT;
};

const getOutTime = () => {
  // @ts-ignore
  const buildFile = resolve(__dirname, '..', '..', 'out', 'build-time.txt');
  let buildTime = 'unknown';
  try {
    buildTime = readFileSync(buildFile, 'utf8');
  } catch (e) {
    console.log('Error reading ./out/build-time.txt');
  }
  return buildTime.trim();
};

export const getBuildTimeString = () => {
  return getOutTime();
};

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
// export function generateFishCompletions() {
//   const script: string = `
// function _fish_lsp_completions
//   set cmd (commandline -opc)
//   if test (count $cmd) -eq 1
//     fish-lsp completions --names
//     return
//   end
//
//   switch $cmd[2]
//     case start
//       printf "--show\t'dump output and stop server'"
//       printf "--enable\t'enable feature'"
//       printf "--disable\t'disable feature'"
//     case min bare
//         printf "--show\t'dump output and stop server'"
//         printf "--enable\t'enable feature'"
//         printf "--disable\t'disable feature'"
//     case startup-configuration
//         printf "--json\t'output as json'"
//         printf "--lua\t'output as lua'"
//     case show-path
//         printf "--json\t'output as json'"
//         printf "--lua\t'output as lua'"
//     case '*'
//       echo ""
//   end
// end
//
// complete -c fish-lsp -f -a '(_fish_lsp_completions)'`;
//   console.log(script);
// }
