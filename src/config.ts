import os from 'os';
import { z } from 'zod';
import { ServerLogsPath, logToStdout } from './logger';
import fishLspEnvVariables from './snippets/fishlspEnvVariables.json';
import { InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver';
import { CodeActionKind } from './code-action';

/********************************************
 **********  Handlers/Providers   ***********
 *******************************************/

export const ConfigHandlerSchema = z.object({
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
});

export const configHandlers = ConfigHandlerSchema.parse({});

export const validHandlers: Array<keyof typeof ConfigHandlerSchema.shape> = [
  'complete', 'hover', 'rename', 'reference', 'logger', 'formatting',
  'codeAction', 'codeLens', 'folding', 'signature', 'executeCommand',
  'inlayHint', 'highlight', 'diagnostic',
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

  /** Handlers that are disabled in the langauge server */
  fish_lsp_disabled_handlers: z.array(z.string()).default([]),

  /** Characters that completion items will be accepted on */
  fish_lsp_commit_characters: z.array(z.string()).default(['\t', ';', ' ']),

  /** Path to the log files */
  fish_lsp_logfile: z.string().default(ServerLogsPath),

  /** Tab size for formatting */
  fish_lsp_format_tabsize: z.number().default(4),

  /** Whether case statements should be indented */
  fish_lsp_format_switch_case: z.boolean().default(true),

  /** All workspaces/paths for the language-server to index */
  fish_lsp_all_indexed_paths: z.array(z.string()).default(['/usr/share/fish', `${os.homedir()}/.config/fish`]),

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
    fish_lsp_logfile: process.env.fish_lsp_logfile,
    fish_lsp_format_tabsize: toNumber(process.env.fish_lsp_format_tabsize),
    fish_lsp_format_switch_case: toBoolean(process.env.fish_lsp_format_switch_case),
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
export function generateJsonSchemaShellScript(showComments: boolean) {
  const result: string[] = [];
  Object.values(fishLspEnvVariables).forEach(entry => {
    const { name, description, valueType } = entry;
    const line = !showComments
      ? `set -gx ${name}\n`
      : [
        `# ${name} <${valueType.toUpperCase()}>`,
        formatDescription(description, 80),
        `set -gx ${name}`,
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
export function showJsonSchemaShellScript(noComments: boolean) {
  const { config } = getConfigFromEnvironmentVariables();
  const findValue = (keyName: string) => {
    return Object.values(fishLspEnvVariables).find(entry => {
      const { name } = entry;
      return name === keyName;
    })!;
  };
  const result: string[] = [];
  for (const item of Object.entries(config)) {
    const [key, value] = item;
    const entry = findValue(key);
    let line = !noComments
      ? `set -gx ${key} `
      : [
        `# ${entry.name} <${entry.valueType.toUpperCase()}>`,
        formatDescription(entry.description, 80),
        `set -gx ${key} `,
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
      } : undefined,
      hoverProvider: configHandlers.hover,
      definitionProvider: configHandlers.reference,
      referencesProvider: configHandlers.reference,
      renameProvider: configHandlers.rename,
      documentFormattingProvider: configHandlers.formatting,
      documentRangeFormattingProvider: configHandlers.formatting,
      foldingRangeProvider: configHandlers.folding,
      codeActionProvider: configHandlers.codeAction ? {
        codeActionKinds: [
          CodeActionKind.RefactorToFunction.value,
          CodeActionKind.RefactorToVariable.value,
          CodeActionKind.QuickFix.append('extraEnd').value,
        ],
        resolveProvider: true,
      } : undefined,
      executeCommandProvider: configHandlers.executeCommand ? {
        commands: ['APPLY_REFACTORING', 'SELECT_REFACTORING', 'APPLY_WORKSPACE_EDIT', 'RENAME', 'onHover', 'rename', 'fish-lsp.executeLine', 'fish-lsp.executeBuffer', 'fish-lsp.createTheme', 'fish-lsp.execute'],
        workDoneProgress: true,
      } : undefined,
      documentSymbolProvider: {
        label: 'Fish-LSP',
      },
      workspaceSymbolProvider: {
        resolveProvider: true,
      },
      documentHighlightProvider: configHandlers.highlight,
      inlayHintProvider: false, /*configHandlers.inlayHint,*/
      signatureHelpProvider: configHandlers.signature ? { workDoneProgress: false, triggerCharacters: ['.'] } : undefined,
    },

  };
}
