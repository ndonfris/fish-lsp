import os from 'os';
import { z } from 'zod';
import { createServerLogger, logger } from './logger';
import { PrebuiltDocumentationMap, EnvVariableJson } from './utils/snippets';
import { Connection, FileOperationRegistrationOptions, FormattingOptions, InitializeParams, InitializeResult, SymbolKind, TextDocumentSyncKind } from 'vscode-languageserver';
import { AllSupportedActions } from './code-actions/action-kinds';
import { LspCommands } from './command';
import { PackageVersion } from './utils/commander-cli-subcommands';
import { FishSymbol } from './parsing/symbol';

/********************************************
 **********  Handlers/Providers   ***********
 *******************************************/

export const ConfigHandlerSchema = z.object({
  complete: z.boolean().default(true),
  hover: z.boolean().default(true),
  rename: z.boolean().default(true),
  definition: z.boolean().default(true),
  implementation: z.boolean().default(true),
  reference: z.boolean().default(true),
  logger: z.boolean().default(true),
  formatting: z.boolean().default(true),
  typeFormatting: z.boolean().default(true),
  codeAction: z.boolean().default(true),
  codeLens: z.boolean().default(true),
  folding: z.boolean().default(true),
  signature: z.boolean().default(true),
  executeCommand: z.boolean().default(true),
  inlayHint: z.boolean().default(true),
  highlight: z.boolean().default(true),
  diagnostic: z.boolean().default(true),
  popups: z.boolean().default(false),
});

/**
 * The configHandlers object stores the enabled/disabled state of the cli flags
 * for the language server handlers.
 *
 * The object (shaped by `ConfigHandlerSchema`) contains a single key and value pair
 * for each handler type that is supported by the language server. Each handler
 * can only either be enabled or disabled, and their default value is `true`.
 *
 * The object could be checked three different times during the initialization of the
 * language server:
 *
 *  1.) The `initializeParams` are passed into the language server during startup
 *      - `initializeParams.fish_lsp_enabled_handlers`
 *      - `initializeParams.fish_lsp_disabled_handlers`

 *  2.) This object parses the shell env values found in the variables:
 *      - `fish_lsp_enabled_handlers`
 *      - `fish_lsp_disabled_handlers`
 *
 *  3.) Next, it uses the cli flags parsed from the `--enable` and `--disable` flags:
 *      - keys are from the validHandlers array.
 *
 * Finally, its values can be used to determine if a handler is enabled or disabled.
 *
 * For example, `configHandlers.complete` will store the state of the `complete` handler.
 */
export const configHandlers = ConfigHandlerSchema.parse({});

export const validHandlers: Array<keyof typeof ConfigHandlerSchema.shape> = [
  'complete', 'hover', 'rename', 'definition', 'implementation', 'reference', 'formatting',
  'typeFormatting', 'codeAction', 'codeLens', 'folding', 'signature', 'executeCommand',
  'inlayHint', 'highlight', 'diagnostic', 'popups',
];

export function updateHandlers(keys: string[], value: boolean): void {
  keys.forEach(key => {
    if (validHandlers.includes(key as keyof typeof ConfigHandlerSchema.shape)) {
      configHandlers[key as keyof typeof ConfigHandlerSchema.shape] = value;
    }
  });
  Config.fixEnabledDisabledHandlers();
}

/********************************************
 **********      User Env        ***********
 *******************************************/

export const ConfigSchema = z.object({
  /** Handlers that are enabled in the language server */
  fish_lsp_enabled_handlers: z.array(z.string()).default([]),

  /** Handlers that are disabled in the language server */
  fish_lsp_disabled_handlers: z.array(z.string()).default([]),

  /** Characters that completion items will be accepted on */
  fish_lsp_commit_characters: z.array(z.string()).default(['\t', ';', ' ']),

  /** Path to the log files */
  fish_lsp_log_file: z.string().default(''),

  /** show startup analysis notification */
  fish_lsp_log_level: z.string().default(''),

  /** All workspaces/paths for the language-server to index */
  fish_lsp_all_indexed_paths: z.array(z.string()).default([`${os.homedir()}/.config/fish`, '/usr/share/fish']),

  /** All workspace/paths that the language-server should be able to rename inside*/
  fish_lsp_modifiable_paths: z.array(z.string()).default([`${os.homedir()}/.config/fish`]),

  /** error code numbers to disable */
  fish_lsp_diagnostic_disable_error_codes: z.array(z.number()).default([]),

  /** fish lsp experimental diagnostics */
  fish_lsp_enable_experimental_diagnostics: z.boolean().default(false),

  /** max background files */
  fish_lsp_max_background_files: z.number().default(10000),

  /** show startup analysis notification */
  fish_lsp_show_client_popups: z.boolean().default(false),

  /** single workspace support */
  fish_lsp_single_workspace_support: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export function getConfigFromEnvironmentVariables(): {
  config: Config;
  environmentVariablesUsed: string[];
  } {
  const rawConfig = {
    fish_lsp_enabled_handlers: process.env.fish_lsp_enabled_handlers?.split(' '),
    fish_lsp_disabled_handlers: process.env.fish_lsp_disabled_handlers?.split(' '),
    fish_lsp_commit_characters: process.env.fish_lsp_commit_characters?.split(' '),
    fish_lsp_log_file: process.env.fish_lsp_log_file || process.env.fish_lsp_logfile,
    fish_lsp_log_level: process.env.fish_lsp_log_level,
    fish_lsp_all_indexed_paths: process.env.fish_lsp_all_indexed_paths?.split(' '),
    fish_lsp_modifiable_paths: process.env.fish_lsp_modifiable_paths?.split(' '),
    fish_lsp_diagnostic_disable_error_codes: process.env.fish_lsp_diagnostic_disable_error_codes?.split(' ').map(toNumber),
    fish_lsp_enable_experimental_diagnostics: toBoolean(process.env.fish_lsp_enable_experimental_diagnostics) || false,
    fish_lsp_max_background_files: toNumber(process.env.fish_lsp_max_background_files),
    fish_lsp_show_client_popups: toBoolean(process.env.fish_lsp_show_client_popups) || false,
    fish_lsp_single_workspace_support: toBoolean(process.env.fish_lsp_single_workspace_support) || false,
  };

  const environmentVariablesUsed = Object.entries(rawConfig)
    .map(([key, value]) => typeof value !== 'undefined' ? key : null)
    .filter((key): key is string => key !== null);

  const config = ConfigSchema.parse(rawConfig);

  return { config, environmentVariablesUsed };
}

export function getDefaultConfiguration(): Config {
  return ConfigSchema.parse({});
}

export function updateBasedOnSymbols(
  symbols: FishSymbol[],
) {
  const fishLspSymbols = symbols.filter(s => s.kind === SymbolKind.Variable && s.name.startsWith('fish_lsp_'));

  const newConfig: Record<keyof Config, unknown> = {} as Record<keyof Config, unknown>;
  const configCopy: Config = Object.assign({}, config);

  for (const s of fishLspSymbols) {
    const configKey = Config.getEnvVariableKey(s.name);
    if (!configKey) {
      continue;
    }

    if (s.isConfigDefinitionWithErase()) {
      const schemaType = ConfigSchema.shape[configKey as keyof z.infer<typeof ConfigSchema>];

      (config[configKey] as any) = schemaType.parse(schemaType._def.defaultValue());
      continue;
    }

    const shellValues = s.valuesAsShellValues();

    if (shellValues.length > 0) {
      if (shellValues.length === 1) {
        const value = shellValues[0];
        if (toBoolean(value)) {
          newConfig[configKey] = toBoolean(value);
          continue;
        }
        if (toNumber(value)) {
          newConfig[configKey] = toNumber(value);
          continue;
        }
        newConfig[configKey] = value;
        continue;
      } else {
        if (shellValues.every(v => !!toNumber(v))) {
          (newConfig[configKey] as any) = shellValues.map(v => toNumber(v));
        } else if (shellValues.every(v => toBoolean(v))) {
          (newConfig[configKey] as any) = shellValues.map(v => toBoolean(v));
        } else {
          (newConfig[configKey] as any) = shellValues;
        }
      }
    }
  }
  Object.assign(config, updateConfigValues(configCopy, newConfig));
}

/**
 * Updates config values from environment variables while maintaining proper types
 * @param config The current config object
 * @param newValues Object containing new values to update
 * @returns Updated config object with proper types
 */
export function updateConfigValues<T extends z.infer<typeof ConfigSchema>>(
  config: T,
  newValues: Record<string, unknown>,
): T {
  // Create a new object to hold our updates
  const updates: Partial<T> = {};

  // Iterate through all keys in newValues
  Object.keys(newValues).forEach(key => {
    if (key in config) {
      const configKey = key as keyof T;
      const schemaType = ConfigSchema.shape[configKey as keyof z.infer<typeof ConfigSchema>];

      if (schemaType) {
        try {
          // Parse the new value through the corresponding Zod schema
          // This ensures type safety and validation
          const parsedValue = schemaType.safeParse(newValues[key]);
          if (parsedValue.success) {
            updates[configKey] = parsedValue.data as T[keyof T];
          } else {
            updates[configKey] = schemaType._def.defaultValue() as T[keyof T];
          }
        } catch (error) {
          // Handle parsing errors - could log or throw depending on your needs
          logger.error(`Failed to parse value for ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  });

  // Return a new config object with the updates
  return { ...config, ...updates };
}

/**
 * convert boolean & number shell strings to their correct type
 */
export const toBoolean = (s?: string): boolean | undefined =>
  typeof s !== 'undefined' ? s === 'true' || s === '1' : undefined;

export const toNumber = (s?: string): number | undefined =>
  typeof s !== 'undefined' ? parseInt(s, 10) : undefined;

function buildOutput(confd: boolean, result: string[]) {
  return confd
    ? [
      '# built by `fish-lsp env --confd`',
      'type -aq fish-lsp || exit',
      'if status is-interactive',
      result.map(line =>
        line.split('\n').map(innerLine => '    ' + innerLine).join('\n').trimEnd(),
      ).join('\n\n').trimEnd(),
      'end',
    ].join('\n')
    : result.join('\n').trimEnd();
}

/**
 * Handles building the output for the `fish-lsp env` command
 */
export function handleEnvOutput(
  outputType: 'show' | 'create' | 'showDefault',
  callbackfn: (str: string) => void = (str) => logger.logToStdout(str),
  opts: {
    confd: boolean;
    comments: boolean;
    global: boolean;
    local: boolean;
    export: boolean;
    only: string[] | undefined;
  } = {
    confd: true,
    comments: true,
    global: true,
    local: true,
    export: true,
    only: undefined,
  },
) {
  const command = getEnvVariableCommand(opts.global, opts.local, opts.export);
  const result: string[] = [];

  const variables = PrebuiltDocumentationMap
    .getByType('variable', 'fishlsp')
    .filter((v) => EnvVariableJson.is(v))
    .filter((v) => !v.isDeprecated);

  const getEnvVariableJsonObject = (keyName: string): EnvVariableJson =>
    variables.find(entry => entry.name === keyName)!;

  // Converts a value to valid fish-shell code
  const convertValueToShellOutput = (value: Config.ConfigValueType) => {
    if (!Array.isArray(value)) return escapeValue(value) + '\n';

    // For arrays
    if (value.length === 0) return "''\n"; // empty array -> ''
    return value.map(v => escapeValue(v)).join(' ') + '\n'; // escape and join array
  };

  // Gets the default value for an environment variable, from the zod schema
  const getDefaultValueAsShellOutput = (key: Config.ConvigKeyType) => {
    const value = Config.getDefaultValue(key);
    return convertValueToShellOutput(value);
  };

  // Builds the line (with its comment if needed) for a fish_lsp_* variable.
  // Does not include the value
  const buildBasicLine = (
    entry: EnvVariableJson,
    command: EnvVariableCommand,
    key: Config.ConvigKeyType,
  ) => {
    if (!opts.comments) return `${command} ${key} `;
    return [
      EnvVariableJson.toCliOutput(entry),
      `${command} ${key} `,
    ].join('\n');
  };

  // builds the output for a fish_lsp_* variable (including the comments, and valid shell code)
  const buildOutputSection = (
    entry: EnvVariableJson,
    command: EnvVariableCommand,
    key: Config.ConvigKeyType,
    value: Config.ConfigValueType,
  ) => {
    let line = buildBasicLine(entry, command, key);
    switch (outputType) {
      case 'show':
        line += convertValueToShellOutput(value);
        break;
      case 'showDefault':
        line += getDefaultValueAsShellOutput(key);
        break;
      case 'create':
      default:
        break;
    }
    return line;
  };

  // show - output what is currently being used
  // create - output the default value
  // showDefault - output the default value
  for (const item of Object.entries(config)) {
    const [key, value] = item;
    if (opts.only && !opts.only.includes(key)) continue;
    const configKey = key as keyof Config;
    const entry = getEnvVariableJsonObject(key);
    const line = buildOutputSection(entry, command, configKey, value);
    result.push(line);
  }

  const output = buildOutput(opts.confd, result);
  callbackfn(output);
  return output;
}

/*************************************
 *******  formatting helpers ********
 ************************************/

function escapeValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    // Replace special characters with their escaped equivalents
    return `'${value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/'/g, "\\'")}'`;
  } else {
    // Return non-string types as they are
    return value.toString();
  }
}

type EnvVariableCommand = 'set -g' | 'set -l' | 'set -gx' | 'set -lx' | 'set' | 'set -x';
/**
 * getEnvVariableCommand - returns the correct command for setting environment variables
 * in fish-shell. Used for generating `fish-lsp env` output. Result string will be
 * either `set -g`, `set -l`, `set -gx`, or `set -lx`, depending on the flags passed.
 * ___
 * ```fish
 * >_ fish-lsp env --no-global --no-export --no-comments | head -n 1
 * set -l fish_lsp_enabled_handlers
 * ```
 * ___
 * @param {boolean} useGlobal - whether to use the global flag
 * @param {boolean} useLocal - allows for skipping the local flag
 * @param {boolean} useExport - whether to use the export flag
 * @returns {string} - the correct command for setting environment variables
 */
function getEnvVariableCommand(useGlobal: boolean, useLocal: boolean, useExport: boolean): EnvVariableCommand {
  let command = 'set';
  command = useGlobal ? `${command} -g` : useLocal ? `${command} -l` : command;
  command = useExport ? command.endsWith('-g') || command.endsWith('-l') ? `${command}x` : `${command} -x` : command;
  return command as 'set -g' | 'set -l' | 'set -gx' | 'set -lx' | 'set' | 'set -x';
}

export const FormatOptions: FormattingOptions = {
  insertSpaces: true,
  tabSize: 4,
};

/********************************************
 ***               Config                 ***
 *******************************************/
export namespace Config {

  /**
   *  fixPopups - updates the `config.fish_lsp_show_client_popups` value based on the 3 cases:
   *   - cli flags include 'popups' -> directly sets `fish_lsp_show_client_popups`
   *   - `config.fish_lsp_enabled_handlers`/`config.fish_lsp_disabled_handlers` includes 'popups'
   *     - if both set && env doesn't set popups -> disable popups
   *     - if enabled && env doesn't set popups-> enable popups
   *     - if disabled && env doesn't set popups -> disable popups
   *     - if env sets popups -> use env for popups && don't override with handler
   *   - `config.fish_lsp_show_client_popups` is set in the environment variables
   *  @param {string[]} enabled - the cli flags that are enabled
   *  @param {string[]} disabled - the cli flags that are disabled
   *  @returns {void}
   */
  export function fixPopups(enabled: string[], disabled: string[]): void {
    /*
     * `enabled/disabled` cli flag arrays are used instead of `configHandlers`
     * because `configHandlers` always sets `popups` to true
     */
    if (enabled.includes('popups') || disabled.includes('popups')) {
      if (enabled.includes('popups')) config.fish_lsp_show_client_popups = true;
      if (disabled.includes('popups')) config.fish_lsp_show_client_popups = false;
      return;
    }

    /**
     * `configHandlers.popups` is set to false, so popups are disabled
     */
    if (configHandlers.popups === false) {
      config.fish_lsp_show_client_popups = false;
      return;
    }

    // envValue is the value of `process.env.fish_lsp_show_client_popups`
    const envValue = toBoolean(process.env.fish_lsp_show_client_popups);

    // check error case where both are set
    if (
      config.fish_lsp_enabled_handlers.includes('popups')
      && config.fish_lsp_disabled_handlers.includes('popups')
    ) {
      if (envValue) {
        config.fish_lsp_show_client_popups = envValue;
        return;
      } else {
        config.fish_lsp_show_client_popups = false;
        return;
      }
    }

    /**
     * `process.env.fish_lsp_show_client_popups` is not set, and
     * `fish_lsp_enabled_handlers/fish_lsp_disabled_handlers` includes 'popups'
     */
    if (typeof envValue === 'undefined') {
      if (config.fish_lsp_enabled_handlers.includes('popups')) {
        config.fish_lsp_show_client_popups = true;
        return;
      }
      /** config.fish_lsp_disabled_handlers is from the fish env */
      if (config.fish_lsp_disabled_handlers.includes('popups')) {
        config.fish_lsp_show_client_popups = false;
        return;
      }
    }

    // `process.env.fish_lsp_show_client_popups` is set and 'popups' is enabled/disabled in the handlers
    return;
  }

  export type ConfigValueType = string | number | boolean | string[] | number[]; // Config[keyof Config] | string[] | number[];
  export type ConvigKeyType = keyof Config;

  export function getDefaultValue(key: keyof Config): Config[keyof Config] {
    const defaults = ConfigSchema.parse({});
    return defaults[key];
  }

  /**
   * All old environment variables mapped to their new key names.
   */
  export const deprecatedKeys: { [deprecated_key: string]: keyof Config; } = {
    ['fish_lsp_logfile']: 'fish_lsp_log_file',
  };

  // Or use a helper function approach for even better typing
  const keys = <T extends z.ZodObject<any>>(schema: T): Array<keyof z.infer<T>> => {
    return Object.keys(schema.shape) as Array<keyof z.infer<T>>;
  };

  export const allKeys: Array<keyof typeof ConfigSchema.shape> = keys(ConfigSchema);

  /**
   * We only need to call this for the `initializationOptions`, but it ensures any string
   * passed in is a valid config key. If the key is not found, it will return undefined.
   *
   * @param {string} key - the key to check
   * @return {keyof Config | undefined} - the key if it exists in the config, or undefined
   */
  export function getEnvVariableKey(key: string): keyof Config | undefined {
    if (key in config) {
      return key as keyof Config;
    }
    if (Object.keys(deprecatedKeys).includes(key)) {
      return deprecatedKeys[key] as keyof Config;
    }
    return undefined;
  }

  /**
   * update the `config` object from the `params.initializationOptions` object,
   * where the `params` are `InitializeParams` from the language client.
   * @param {Config | null} initializationOptions - the initialization options from the client
   * @returns {void} updates both the `config` and `configHandlers` objects
   */
  export function updateFromInitializationOptions(initializationOptions: Config | null): void {
    if (!initializationOptions) return;
    ConfigSchema.parse(initializationOptions);
    Object.keys(initializationOptions).forEach((key) => {
      const configKey = getEnvVariableKey(key);
      if (!configKey) return;
      (config[configKey] as any) = initializationOptions[configKey];
    });
    if (initializationOptions.fish_lsp_enabled_handlers) {
      updateHandlers(initializationOptions.fish_lsp_enabled_handlers, true);
    }
    if (initializationOptions.fish_lsp_disabled_handlers) {
      updateHandlers(initializationOptions.fish_lsp_disabled_handlers, false);
    }
  }

  /**
   * Call this after updating the `configHandlers` to ensure that all
   * enabled/disabled handlers are set correctly.
   */
  export function fixEnabledDisabledHandlers(): void {
    config.fish_lsp_enabled_handlers = [];
    config.fish_lsp_disabled_handlers = [];
    Object.keys(configHandlers).forEach((key) => {
      const value = configHandlers[key as keyof typeof ConfigHandlerSchema.shape];
      if (!value) {
        config.fish_lsp_disabled_handlers.push(key);
      } else {
        config.fish_lsp_enabled_handlers.push(key);
      }
    });
  }

  /**
   * getResultCapabilities - returns the capabilities for the language server based on the
   * Uses both global objects: `config` and `configHandlers`
   * Therefore, these values must be set/updated before calling this function.
   */
  export function getResultCapabilities(): InitializeResult {
    return {
      capabilities: {
        // textDocumentSync: TextDocumentSyncKind.Full,
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: { includeText: true },
          // willSave: true,
          // willSaveWaitUntil: true,
        },
        completionProvider: configHandlers.complete ? {
          resolveProvider: true,
          // allCommitCharacters: config.fish_lsp_commit_characters,
          workDoneProgress: false,
          // triggerCharacters: ['$'],
        } : undefined,
        hoverProvider: configHandlers.hover,
        definitionProvider: configHandlers.definition,
        implementationProvider: configHandlers.implementation,
        referencesProvider: configHandlers.reference,
        renameProvider: configHandlers.rename,
        documentFormattingProvider: configHandlers.formatting,
        documentRangeFormattingProvider: configHandlers.formatting,
        foldingRangeProvider: configHandlers.folding,
        codeActionProvider: configHandlers.codeAction ? {
          codeActionKinds: [...AllSupportedActions],
          workDoneProgress: true,
          resolveProvider: true,
        } : undefined,
        executeCommandProvider: configHandlers.executeCommand ? {
          commands: [...AllSupportedActions, ...LspCommands],
          workDoneProgress: true,
        } : undefined,
        documentSymbolProvider: {
          label: 'fish-lsp',
        },
        workspaceSymbolProvider: {
          resolveProvider: true,
        },
        documentHighlightProvider: configHandlers.highlight,
        inlayHintProvider: configHandlers.inlayHint,
        // codeLensProvider: configHandlers.codeLens ? {
        //   resolveProvider: true,
        //   workDoneProgress: true,
        // } : undefined,
        // codeLensProvider: false,
        signatureHelpProvider: configHandlers.signature ? { workDoneProgress: false, triggerCharacters: ['.'] } : undefined,
        documentOnTypeFormattingProvider: configHandlers.typeFormatting ? {
          firstTriggerCharacter: '.',
          moreTriggerCharacter: [';', '}', ']', ')'],
        } : undefined,
        workspace: {
          // fileOperations: {
          //   didRename: FileListenerFilter,
          // },
          workspaceFolders: {
            supported: true,
            changeNotifications: true,
          },
        },
      },
      serverInfo: {
        name: 'fish-lsp',
        version: PackageVersion,
      },
    };
  }

  // might need later in the getResultCapabilities() object
  export const FileListenerFilter: FileOperationRegistrationOptions = {
    filters: [
      {
        pattern: {
          glob: '**/*.fish',
          matches: 'file',
          options: {
            ignoreCase: true,
          },
        },
      },
    ],
  };

  /**
   * *******************************************
   * ***        initializeResult             ***
   * *******************************************
   * * The `initializeResult` is the result of the `initialize` method
   */
  export function initialize(params: InitializeParams, connection: Connection) {
    updateFromInitializationOptions(params.initializationOptions);
    createServerLogger(config.fish_lsp_log_file, connection.console);
    const result = getResultCapabilities();
    logger.log({ onInitializedResult: result });
    return result;
  }
}

// create config to be used globally
export const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables();
