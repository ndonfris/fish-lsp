import os from 'os';
import { z } from 'zod';
import { ServerLogsPath } from './logger';
import fishLspEnvVariables from '../snippets/fish_lsp_env_variables.json';

export type ConfigHandlerType = {
  complete: boolean;
  hover: boolean;
  rename: boolean;
  reference: boolean;
  logger: boolean;
  formatting: boolean;
  codeAction: boolean;
  codeLens: boolean;
  folding: boolean;
  signature: boolean;
  executeCommand: boolean;
  inlayHint: boolean;
  highlight: boolean;
  diagnostic: boolean;
};

// Initialize the options dictionary with default false values
export const configHandlers: ConfigHandlerType = {
  complete: true,
  hover: true,
  rename: true,
  reference: true,
  logger: true,
  formatting: true,
  codeAction: true,
  codeLens: true,
  folding: true,
  signature: true,
  executeCommand: true,
  inlayHint: true,
  highlight: true,
  diagnostic: true,
};

export const validHanlders: Array<keyof ConfigHandlerType> = ['complete', 'hover', 'rename', 'reference', 'logger', 'formatting', 'codeAction', 'codeLens',  'folding', 'signature', 'executeCommand', 'inlayHint', 'highlight', 'diagnostic' ];
// Function to safely update options based on an array of keys and a boolean value
export function updateHanlders(keys: string[], value: boolean): void {
    keys.forEach(key => {
        if (validHanlders.includes(key as keyof ConfigHandlerType)) {
            configHandlers[key as keyof ConfigHandlerType] = value;
        }
    });
}

// Parse environment variables
// const envEnable = process.env.CLI_ENABLE ? process.env.CLI_ENABLE.split(' ') : [];
// const envDisable = process.env.CLI_DISABLE ? process.env.CLI_DISABLE.split(' ') : [];

// Apply environment variables
// updateOptions(envEnable, true);
// updateOptions(envDisable, false);

export const ConfigSchema = z.object({
  /** Handlers that are enabled in the language server */
  fish_lsp_enabled_handlers: z.array(z.string()).default([]),

  /** Handlers that are disabled in the langauge server */
  fish_lsp_disabled_handlers: z.array(z.string()).default([]),

  /** Characters that completion items will be accepted on */
  fish_lsp_commit_characters: z.array(z.string()).default([ '\t', ';', ' ' ]),

  /** Path to the log files */
  fish_lsp_logfile: z.string().default(ServerLogsPath),

  /** Tab size for formatting */
  fish_lsp_format_tabsize: z.number().default(4),

  /** Whether case statements should be indented */
  fish_lsp_format_switch_case: z.boolean().default(true),

  /** All workspaces/paths for the language-server to index */
  fish_lsp_all_indexed_paths: z.array(z.string()).default([ '/usr/share/fish', `${os.homedir()}/.config/fish` ]),

  /** All workspace/paths that the language-server should be able to rename inside*/
  fish_lsp_modifiable_paths: z.array(z.string()).default([ `${os.homedir()}/.config/fish` ]),

  /** error code numbers to disable */
  fish_lsp_diagnostic_disable_error_codes: z.array(z.number()).default([]),

  /** max background files */
  fish_lsp_max_background_files: z.number().default(500)

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
    fish_lsp_logfile: process.env.fish_lsp_logfile,
    fish_lsp_format_tabsize: toNumber(process.env.fish_lsp_format_tabsize),
    fish_lsp_format_switch_case: toBoolean(process.env.fish_lsp_format_switch_case),
    fish_lsp_all_indexed_paths: process.env.fish_lsp_all_indexed_paths?.split(' '),
    fish_lsp_modifiable_paths: process.env.fish_lsp_modifiable_paths?.split(' '),
    fish_lsp_diagnostic_disable_error_codes: process.env.fish_lsp_diagnostic_disable_error_codes?.split(' ').map(toNumber),
    fish_lsp_max_background_files: toNumber(process.env.fish_lsp_max_background_files),
  };

  const environmentVariablesUsed = Object.entries(rawConfig)
    .map(([ key, value ]) => (typeof value !== 'undefined' ? key : null))
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


/**
 * generateJsonSchemaShellScript - just prints the starter template for the schema 
 * in fish-shell
 */
export function generateJsonSchemaShellScript() {
  Object.values(fishLspEnvVariables).forEach(entry => {
    const { name, description, type } = entry;
    console.log(`# ${name} <${type.toUpperCase()}>`);
    console.log(formatDescription(description, 80));
    console.log(`set -gx ${name}`);
    console.log();
  });
}

/**
 * showJsonSchemaShellScript - prints the current environment schema 
 * in fish
 */
export function showJsonSchemaShellScript() {
  const { config } = getConfigFromEnvironmentVariables();
  const findValue = (keyName: string) => {
    return Object.values(fishLspEnvVariables).find(entry => {
      const { name } = entry;
      return name === keyName;
    })!;
  };
  for (const item of Object.entries(config)) {
    const [ key, value ] = item;
    const entry = findValue(key);
    let line = [
      `# ${entry.name} <${entry.type.toUpperCase()}>`,
      formatDescription(entry.description, 80),
      `set -gx ${key} `
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
    console.log(line);
  }
}

/** formatting helpers */

// Function to format descriptions into multi-line comments
function formatDescription(description: string, maxLineLength: number = 80): string {
  const words = description.split(' ');
  let currentLine = '#';
  let formattedDescription = '';

  for (const word of words) {
    // Check if adding the next word would exceed the line length
    if (currentLine.length + word.length + 1 > maxLineLength) {
      formattedDescription += currentLine + '\n';
      currentLine = '# ' + word; // Start a new line with the word
    } else {
      // Append word to the current line
      currentLine += (currentLine.length > 1 ? ' ' : ' ') + word;
    }
  }

  // Append any remaining text in the current line
  if (currentLine.length > 1) {
    formattedDescription += currentLine;
  }

  return formattedDescription;
}

function escapeValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    // Replace special characters with their escaped equivalents
    return `'${value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/'/g, "\\'")}'`;
  } else {
    // Return non-string types as they are
    return value.toString();
  }
}