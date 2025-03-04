import os from 'os';
import { z } from 'zod';
import { logToStdout } from './logger';
import { PrebuiltDocumentationMap, EnvVariableJson } from './utils/snippets';
import { InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { AllSupportedActions } from './code-actions/action-kinds';
import { LspCommands } from './command';

/********************************************
 **********  Handlers/Providers   ***********
 *******************************************/

export const ConfigHandlerSchema = z.object({
  // inlineValue: z.boolean().default(true),
  // inlineCompletion: z.boolean().default(true),
  complete: z.boolean().default(true),
  hover: z.boolean().default(true),
  rename: z.boolean().default(true),
  reference: z.boolean().default(true),
  logger: z.boolean().default(true),
  formatting: z.boolean().default(true),
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
 * USAGE:
 *  1.) This object first uses the parsed shell env values found in the variables:
 *      - `fish_lsp_enabled_handlers`
 *      - `fish_lsp_disabled_handlers`
 *
 *  2.) Next, it uses the cli flags parsed from the `--enable` and `--disable` flags:
 *      - keys are from the validHandlers array.
 *
 *  3.) Finally, its values can be used to determine if a handler is enabled or disabled.
 */
export const configHandlers = ConfigHandlerSchema.parse({});

export const validHandlers: Array<keyof typeof ConfigHandlerSchema.shape> = [
  'complete', 'hover', 'rename', 'reference', 'formatting',
  'codeAction', 'codeLens', 'folding', 'signature', 'executeCommand',
  'inlayHint', 'highlight', 'diagnostic', 'popups',
];

export function updateHandlers(keys: string[], value: boolean): void {
  keys.forEach(key => {
    if (validHandlers.includes(key as keyof typeof ConfigHandlerSchema.shape)) {
      configHandlers[key as keyof typeof ConfigHandlerSchema.shape] = value;
    }
  });
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

  /** max background files */
  fish_lsp_max_background_files: z.number().default(1000),

  /** show startup analysis notification */
  fish_lsp_show_client_popups: z.boolean().default(true),
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
    fish_lsp_max_background_files: toNumber(process.env.fish_lsp_max_background_files),
    fish_lsp_show_client_popups: toBoolean(process.env.fish_lsp_show_client_popups),
  };

  const environmentVariablesUsed = Object.entries(rawConfig)
    .map(([key, value]) => typeof value !== 'undefined' ? key : null)
    .filter((key): key is string => key !== null);

  const config = ConfigSchema.parse(rawConfig);

  return { config, environmentVariablesUsed };
}

export function updateConfigFromInitializationOptions(initializationOptions: Config | null): void {
  if (initializationOptions === null) return;
  ConfigSchema.parse(initializationOptions);
  Object.keys(initializationOptions).forEach((key) => {
    const configKey = key as keyof Config;
    if (configKey in config) {
      (config[configKey] as any) = initializationOptions[configKey];
    }
  });
  if (initializationOptions.fish_lsp_enabled_handlers) {
    updateHandlers(initializationOptions.fish_lsp_enabled_handlers, true);
  }
  if (initializationOptions.fish_lsp_disabled_handlers) {
    updateHandlers(initializationOptions.fish_lsp_disabled_handlers, false);
  }
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

/**
 * generateJsonSchemaShellScript - just prints the starter template for the schema
 * in fish-shell
 */
export function generateJsonSchemaShellScript(showComments: boolean, useGlobal: boolean, useLocal: boolean, useExport: boolean) {
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
        EnvVariableJson.toCliOutput(entry, { includeDefaultValue: true, includeType: true, includeOptions: true, wrap: true }),
        `${command} ${name}`,
        '',
      ].join('\n');
    result.push(line);
  });
  const output = result.join('\n').trimEnd();
  logToStdout(output);
}

/**
 * showJsonSchemaShellScript - prints the current environment schema
 * in fish
 */
export function showJsonSchemaShellScript(showComments: boolean, useGlobal: boolean, useLocal: boolean, useExport: boolean) {
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
        EnvVariableJson.toCliOutput(entry, { includeDefaultValue: true, includeType: true, includeOptions: true, wrap: true }),
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
  const output = result.join('\n').trimEnd();
  logToStdout(output);
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

/********************************************
 ***        initializeResult              ***
 *******************************************/

/* in server onInitialize() */
export function adjustInitializeResultCapabilitiesFromConfig(configHandlers: z.infer<typeof ConfigHandlerSchema>, userConfig: z.infer<typeof ConfigSchema>): InitializeResult {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: configHandlers.complete ? {
        resolveProvider: true,
        allCommitCharacters: userConfig.fish_lsp_commit_characters,
        workDoneProgress: true,
        triggerCharacters: ['$'],
      } : undefined,
      hoverProvider: configHandlers.hover,
      definitionProvider: configHandlers.reference,
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
      // inlineValueProvider: configHandlers.inlineValue ? true : undefined,
      // inlineCompletionProvider: configHandlers.inlineCompletion ? true : undefined,
      inlayHintProvider: configHandlers.inlayHint,
      signatureHelpProvider: configHandlers.signature ? { workDoneProgress: false, triggerCharacters: ['.'] } : undefined,
      // codeLensProvider: {
      //   resolveProvider: true,
      // }
    },

  };
}

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
}

// create config to be used globally
export const { config, environmentVariablesUsed } = getConfigFromEnvironmentVariables();
