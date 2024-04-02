
import deepmerge from 'deepmerge';
import { LspDocuments } from './document';
import {
  Connection, FormattingOptions, InitializeParams, LSPAny,
} from 'vscode-languageserver';
import { homedir } from 'os';

export interface ServerPreferences {
  hirearchicalDocumentSymbolSupport?: boolean;
  completions?: CompletionOptions;
  documentation?: DocumentationOptions;
  // debugging
  formatting?: FishFormattingOptions;
  workspaces?: FishWorkspaceOptions;
  codeActions?: FishCodeActionsOptions;
  diagnostics?: FishDiagnosticsOptions;
}

const DEFAULT_PREFERENCES: ServerPreferences = {
  hirearchicalDocumentSymbolSupport: true,
  completions: {
    enable: true,
    functions: true,
    variables: true,
    extraDetails: true,
    expandAbbreviations: {
      enabled: true,
      keys: [';', ' ', '\t'],
    },
  },
  documentation: {
    enable: true,
    syntax: 'markdown',
    manPage: {
      showLinks: true,
      removeLeadingTabs: true,
    },
    symbolPrefrence: {
      showComments: true,
      showCode: true,
      showLine: true,
      showScope: true,
    },
    fallbackCommands: [
      // COULD BE:
      //{
      //    command: 'tldr',
      //    args: [''],
      //    symbolType: ['function', 'command'],
      //},
      //{
    ],
  },
  formatting: {
    formatOnSave: false,
    tabSize: 4,
    insertSpaces: true,
    trimTrailingWhitespace: true,
    trimFinalNewlines: true,
    insertFinalNewline: true,
    removeLeadingSwitchCaseWhitespace: true,
  },
  workspaces: {
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
    create: {
      completionsFile: false,
      fromArgParse: false,
    },
    extract: {
      toPrivateFunction: false,
      toLocalVariable: false,
    },
    quickfix: {
      addMissingEnd: true,
      removeUnnecessaryEnd: true,
    },
  },
  diagnostics: {
    enable: true,
    maxNumberOfProblems: 10,
  },
};

export interface CompletionOptions {
  enable: boolean;
  functions: boolean;
  variables: boolean;
  extraDetails: boolean;
  expandAbbreviations: {
    enabled: boolean;
    keys: string[];
  };
}

type SymbolType = 'function' | 'command' | 'variable';
interface FallbackCommand {
  command: string;
  args: string[];
  symbolType: SymbolType[];
}
export interface DocumentationOptions {
  enable: boolean;
  syntax: 'markdown' | 'plaintext';
  fallbackCommands: FallbackCommand[];
  manPage: {
    showLinks: boolean;
    removeLeadingTabs: boolean;
  };
  symbolPrefrence: {
    showComments: boolean;
    showCode: boolean;
    showLine: boolean;
    showScope: boolean;
  };
}

export interface FishFormattingOptions extends FormattingOptions {
  formatOnSave?: boolean;
  trimTrailingWhitespace?: boolean;
  trimFinalNewlines?: boolean;
  removeLeadingSwitchCaseWhitespace?: boolean;
  insertFinalNewline?: boolean;
}

export interface FishWorkspaceOptions {
  symbols: {
    enable: boolean;
    max: number;
    prefer: 'functions' | 'variables';
  };
  paths: {
    defaults: string[];
    allowRename: string[];
  };
}

export interface FishCodeActionsOptions {
  enable: boolean;
  create: {
    completionsFile: boolean;
    fromArgParse: boolean;
  };
  extract: {
    toPrivateFunction: boolean;
    toLocalVariable: boolean;
  };
  quickfix: {
    addMissingEnd: boolean;
    removeUnnecessaryEnd: boolean;
  };
}

export interface FishDiagnosticsOptions {
  enable: boolean;
  maxNumberOfProblems: number;
}

export type ConfigKeys = keyof Required<ServerPreferences>;

export class ConfigManager {
  private _preferences: Required<ServerPreferences> = deepmerge({}, DEFAULT_PREFERENCES, {});
  //private _preferences: Required<ServerPreferences> = Object.assign({}, DEFAULT_PREFERENCES, {}) as Required<ServerPreferences>

  constructor(private readonly documents: LspDocuments) {}

  public mergePreferences(preferences: ServerPreferences): void {
    ////this._preferences = deepmerge(this._preferences, preferences);
    this._preferences = { ...this._preferences, ...preferences };
  }

  public getFormattingOptions() : FishFormattingOptions {
    return this._preferences.formatting;
  }

  // @TODO: write config
  public getInlayHintsEnabled() : boolean {
    return true;
  }

  public getWorkspaceOptions() : FishWorkspaceOptions {
    return this._preferences.workspaces;
  }

  public getOption(key: ConfigKeys) : ServerPreferences[ConfigKeys] {
    return this._preferences[key];
  }

  public updateOption(key: ConfigKeys, value: ServerPreferences[ConfigKeys]) : void {
    // if (key in this._preferences) {
    //     this._preferences[key] = value;
    // }
  }

  public get options() : ServerPreferences {
    return this._preferences;
  }
}

/**
 * Initialize the configuration manager
 * for the various options specified at
 * runtime.
 */
export function initParamSeter(processId: number, rootUri: string, initializeOptions: LSPAny) {
  // const results: InitializeParams = {
  //     processId,
  //     rootUri,
  // };
  // const configManager = new ConfigManager(

  // return configManager;
}
