import os from 'os';
import { z } from 'zod';
import { createServerLogger, logger } from './logger';
import { PrebuiltDocumentationMap, EnvVariableJson } from './utils/snippets';
import { Connection, FileOperationRegistrationOptions, FormattingOptions, InitializeParams, InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver';
import { AllSupportedActions } from './code-actions/action-kinds';
import { LspCommands } from './command';
import { PackageVersion } from './utils/commander-cli-subcommands';

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
  popups: z.boolean().default(true),
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
  fish_lsp_show_client_popups: z.boolean().default(true),

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
    fish_lsp_show_client_popups: toBoolean(process.env.fish_lsp_show_client_popups) || true,
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

/**
 * convert boolean & number shell strings to their correct type
 */
const toBoolean = (s?: string): boolean | undefined =>
  typeof s !== 'undefined' ? s === 'true' || s === '1' : undefined;

const toNumber = (s?: string): number | undefined =>
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
 * generateJsonSchemaShellScript - just prints the starter template for the schema
 * in fish-shell
 */
export function generateJsonSchemaShellScript(confd: boolean, showComments: boolean, useGlobal: boolean, useLocal: boolean, useExport: boolean) {
  const result: string[] = [];
  const command = getEnvVariableCommand(useGlobal, useLocal, useExport);

  const variables = PrebuiltDocumentationMap
    .getByType('variable', 'fishlsp')
    .filter((v) => EnvVariableJson.is(v))
    .filter((v) => !v.isDeprecated);

  variables.forEach(entry => {
    const { name } = entry;
    const line = !showComments
      ? `${command} ${name}\n`
      : [
        EnvVariableJson.toCliOutput(entry),
        `${command} ${name}`,
        '',
      ].join('\n');
    result.push(line);
  });
  const output = buildOutput(confd, result);
  logger.logToStdout(output);
}

/**
 * showJsonSchemaShellScript - prints the current environment schema
 * in fish
 */
export function showJsonSchemaShellScript(confd: boolean, showComments: boolean, useGlobal: boolean, useLocal: boolean, useExport: boolean) {
  const { config } = getConfigFromEnvironmentVariables();
  const command = getEnvVariableCommand(useGlobal, useLocal, useExport);
  const variables = PrebuiltDocumentationMap
    .getByType('variable', 'fishlsp')
    .filter((v) => EnvVariableJson.is(v))
    .filter((v) => !v.isDeprecated);

  const findValue = (keyName: string) => {
    return variables.find(entry => entry.name === keyName)!;
  };

  const result: string[] = [];
  for (const item of Object.entries(config)) {
    const [key, value] = item;
    const entry = findValue(key);

    let line = !showComments
      ? `${command} ${key} `
      : [
        EnvVariableJson.toCliOutput(entry),
        `${command} ${key} `,
      ].join('\n');

    if (Array.isArray(value)) {
      if (value.length === 0) {
        line += "''\n"; // Print two single quotes for empty arrays
      } else {
        // Map each value to ensure any special characters are escaped
        const escapedValues = value.map(v => escapeValue(v));
        line += escapedValues.join(' ') + '\n'; // Join array values with a space
      }
    } else {
      // Use a helper function to handle string escaping
      line += escapeValue(value) + '\n';
    }
    result.push(line);
  }
  const output = buildOutput(confd, result);
  logger.logToStdout(output);
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
function getEnvVariableCommand(useGlobal: boolean, useLocal: boolean, useExport: boolean): 'set -g' | 'set -l' | 'set -gx' | 'set -lx' | 'set' | 'set -x' {
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

  /**
   * All old environment variables mapped to their new key names.
   */
  export const deprecatedKeys: { [deprecated_key: string]: keyof Config; } = {
    ['fish_lsp_logfile']: 'fish_lsp_log_file',
  };

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
  export function updateFromInitializationOptions(initializationOptions: Partial<Config> | null): void {
    if (initializationOptions === null) return;
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
          change: TextDocumentSyncKind.Full,
        },
        completionProvider: configHandlers.complete ? {
          resolveProvider: true,
          allCommitCharacters: config.fish_lsp_commit_characters,
          workDoneProgress: true,
          triggerCharacters: ['$'],
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
          label: 'Fish-LSP',
        },
        workspaceSymbolProvider: {
          resolveProvider: true,
        },
        documentHighlightProvider: configHandlers.highlight,
        inlayHintProvider: configHandlers.inlayHint,
        signatureHelpProvider: configHandlers.signature ? { workDoneProgress: false, triggerCharacters: ['.'] } : undefined,
        documentLinkProvider: {
          resolveProvider: true,
        },
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
