import { Connection, ExecuteCommandParams, MessageType, /** Position, */ Range, Location, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { codeActionHandlers } from './code-actions/code-action-handler';
import { createFixAllAction } from './code-actions/quick-fixes';
import { Config, config, EnvVariableTransformers, getDefaultConfiguration, handleEnvOutput } from './config';
import { getDiagnostics } from './diagnostics/validate';
import { LspDocuments } from './document';
import { buildExecuteNotificationResponse, execEntireBuffer, fishLspPromptIcon, useMessageKind } from './execute-handler';
import { logger } from './logger';
import { env } from './utils/env-manager';
import { execAsync, execAsyncF, execAsyncFish } from './utils/exec';
import { EnvVariableJson, PrebuiltDocumentationMap } from './utils/snippets';
import { pathToUri, uriToReadablePath } from './utils/translation';
import { getRange } from './utils/tree-sitter';
import { workspaceManager } from './utils/workspace-manager';
import { PkgJson } from './utils/commander-cli-subcommands';
import FishServer from './server';
import { SyncFileHelper } from './utils/file-operations';

// Define command name constants to avoid string literals
export const CommandNames = {
  EXECUTE_RANGE: 'fish-lsp.executeRange',
  EXECUTE_LINE: 'fish-lsp.executeLine',
  EXECUTE: 'fish-lsp.execute',
  EXECUTE_BUFFER: 'fish-lsp.executeBuffer',
  CREATE_THEME: 'fish-lsp.createTheme',
  SHOW_STATUS_DOCS: 'fish-lsp.showStatusDocs',
  SHOW_WORKSPACE_MESSAGE: 'fish-lsp.showWorkspaceMessage',
  UPDATE_WORKSPACE: 'fish-lsp.updateWorkspace',
  FIX_ALL: 'fish-lsp.fixAll',
  TOGGLE_SINGLE_WORKSPACE_SUPPORT: 'fish-lsp.toggleSingleWorkspaceSupport',
  GENERATE_ENV_VARIABLES: 'fish-lsp.generateEnvVariables',
  SHOW_ENV_VARIABLES: 'fish-lsp.showEnvVariables',
  CHECK_HEALTH: 'fish-lsp.checkHealth',
  SHOW_REFERENCES: 'fish-lsp.showReferences',
  SHOW_INFO: 'fish-lsp.showInfo',
} as const;

export const LspCommands = [...Array.from(Object.values(CommandNames))];

export type CommandName = typeof CommandNames[keyof typeof CommandNames];

// Type for command arguments
export type CommandArgs = {
  // All commands now use variadic string[] with parser functions
  [CommandNames.EXECUTE_RANGE]: string[]; // [path, "start,end"] or [path, start, end]
  [CommandNames.EXECUTE_LINE]: string[];  // [path, line]
  [CommandNames.EXECUTE]: string[];  // [path] (alias for EXECUTE_BUFFER)
  [CommandNames.EXECUTE_BUFFER]: string[];  // [path]
  [CommandNames.CREATE_THEME]: string[];  // [path, asVariables?]
  [CommandNames.SHOW_STATUS_DOCS]: [statusCode: string];  // Not converted yet
  [CommandNames.SHOW_WORKSPACE_MESSAGE]: [];
  [CommandNames.UPDATE_WORKSPACE]: string[];  // [path, ...flags]
  [CommandNames.FIX_ALL]: string[];  // [path]
  [CommandNames.TOGGLE_SINGLE_WORKSPACE_SUPPORT]: [];
  [CommandNames.GENERATE_ENV_VARIABLES]: [path: string];
  [CommandNames.SHOW_REFERENCES]: [path: string, references: Location[]];  // Add this line
  [CommandNames.SHOW_INFO]: [];
  [CommandNames.SHOW_ENV_VARIABLES]: string[];  // [...opts]
};

// Command help messages for user-facing documentation
const CommandHelpMessages = {
  [CommandNames.EXECUTE_RANGE]: {
    usage: [
      'fish-lsp.executeRange <path> <startLine>,<endLine>',
      'fish-lsp.executeRange <path> <startLine> <endLine>',
    ],
    examples: [
      'fish-lsp.executeRange ~/.config/fish/config.fish 1,10',
      'fish-lsp.executeRange ~/.config/fish/config.fish 1 10',
      'fish-lsp.executeRange $XDG_CONFIG_HOME/fish/config.fish 5 15',
    ],
    description: 'Execute a range of lines from a Fish script',
  },
  [CommandNames.EXECUTE_LINE]: {
    usage: 'fish-lsp.executeLine <path> <line>',
    examples: [
      'fish-lsp.executeLine ~/.config/fish/config.fish 7',
      'fish-lsp.executeLine /path/to/script.fish 42',
    ],
    description: 'Execute a single line from a Fish script',
  },
  [CommandNames.EXECUTE_BUFFER]: {
    usage: 'fish-lsp.executeBuffer <path>',
    examples: [
      'fish-lsp.executeBuffer ~/.config/fish/config.fish',
    ],
    description: 'Execute the entire Fish script buffer',
  },
  [CommandNames.CREATE_THEME]: {
    usage: 'fish-lsp.createTheme <path> [asVariables]',
    examples: [
      'fish-lsp.createTheme ~/.config/fish/theme.fish',
      'fish-lsp.createTheme ~/theme.fish true',
    ],
    description: 'Create a Fish theme configuration file',
  },
  [CommandNames.SHOW_STATUS_DOCS]: {
    usage: 'fish-lsp.showStatusDocs <statusCode>',
    examples: [
      'fish-lsp.showStatusDocs 0',
      'fish-lsp.showStatusDocs 127',
    ],
    description: 'Show documentation for a Fish exit status code',
  },
  [CommandNames.FIX_ALL]: {
    usage: 'fish-lsp.fixAll <path>',
    examples: [
      'fish-lsp.fixAll ~/.config/fish/config.fish',
    ],
    description: 'Apply all available quick fixes to a Fish script',
  },
  [CommandNames.SHOW_REFERENCES]: {
    usage: [
      'fish-lsp.showReferences <symbolName>',
      'fish-lsp.showReferences <path> <line>,<character>',
      'fish-lsp.showReferences <path> <line> <character>',
    ],
    examples: [
      'fish-lsp.showReferences my_function',
      'fish-lsp.showReferences ~/.config/fish/config.fish 7,10',
      'fish-lsp.showReferences $XDG_CONFIG_HOME/fish/config.fish 7 10',
      'fish-lsp.showReferences /absolute/path/to/file.fish 7 10',
    ],
    description: 'Find all references to a symbol or location in Fish scripts',
  },
} as const;

// Helper to format command help message
function formatCommandHelp(commandName: CommandName, reason?: string): string {
  const help = CommandHelpMessages[commandName as keyof typeof CommandHelpMessages];
  if (!help) {
    return `No help available for command: ${commandName}`;
  }

  const usageLines = (Array.isArray(help.usage) ? help.usage : [help.usage]) as string[];
  const reasonText = reason ? `Invalid arguments: ${reason}\n\n` : '';

  return (
    reasonText +
    `${help.description}\n\n` +
    'Usage:\n' +
    usageLines.map((u: string) => `  ${u}`).join('\n') +
    '\n\nExamples:\n' +
    help.examples.map((e: string) => `  ${e}`).join('\n')
  );
}

// Utility for parsing number arguments (handles string/number inputs and quoted strings)
type ParsedNumber =
  | { success: true; value: number; }
  | { success: false; error: string; };

function parseNumberArg(value: string | number, argName: string = 'argument'): ParsedNumber {
  if (typeof value === 'number') {
    return { success: true, value };
  }

  if (typeof value === 'string') {
    // Remove leading/trailing single or double quotes
    const stripped = value.replace(/^['"]|['"]$/g, '');
    const num = parseInt(stripped, 10);

    if (isNaN(num)) {
      return { success: false, error: `${argName} must be a number, got: "${value}"` };
    }

    return { success: true, value: num };
  }

  return { success: false, error: `${argName} must be a string or number, got: ${typeof value}` };
}

/**
 * Converts a 1-indexed line number (user-facing) to 0-indexed (LSP internal).
 * User sees line 7 in editor → LSP uses line 6.
 *
 * @param line - 1-indexed line number from user input
 * @returns 0-indexed line number for LSP operations
 * @example toZeroIndexed(7) // returns 6
 */
function toZeroIndexed(line: number): number {
  return line - 1;
}

/**
 * Parses and validates a path argument from command arguments.
 * Automatically expands environment variables and tilde.
 *
 * @param args - Array of command arguments
 * @param argIndex - Index of the path argument (default: 0)
 * @returns Parsed path with expansion applied, or error
 *
 * @example
 * parsePathArg(['~/.config/fish/config.fish'])
 * // { success: true, path: '/home/user/.config/fish/config.fish' }
 *
 * parsePathArg(['$HOME/script.fish'])
 * // { success: true, path: '/home/user/script.fish' }
 *
 * parsePathArg([])
 * // { success: false, error: 'Missing path argument' }
 */
type ParsedPath =
  | { success: true; path: string; }
  | { success: false; error: string; };

function parsePathArg(args: string[], argIndex: number = 0): ParsedPath {
  if (argIndex >= args.length) {
    return { success: false, error: 'Missing path argument' };
  }

  const pathArg = args[argIndex];
  if (!pathArg || typeof pathArg !== 'string') {
    return { success: false, error: 'Path must be a string' };
  }

  // Expand path immediately (handles ~, $ENV_VARS, etc.)
  const expandedPath = SyncFileHelper.expandEnvVars(pathArg);

  return { success: true, path: expandedPath };
}

/**
 * Parses a pair of numbers from flexible input formats.
 * Supports: "7,10" (comma-separated) or "7" "10" (space-separated)
 *
 * NOTE: This is a reusable utility that can be applied to other commands in the future.
 * Consider refactoring other multi-number parameter commands to use this pattern.
 *
 * @param args - Array of arguments that may contain the number pair
 * @param startIndex - Index in args where the pair starts
 * @param firstName - Name of first number (for error messages)
 * @param secondName - Name of second number (for error messages)
 * @returns Parsed number pair or error
 *
 * @example
 * parseNumberPair(['7,10'], 0, 'start', 'end') // { success: true, first: 7, second: 10 }
 * parseNumberPair(['7', '10'], 0, 'line', 'char') // { success: true, first: 7, second: 10 }
 */
type ParsedNumberPair =
  | { success: true; first: number; second: number; }
  | { success: false; error: string; };

function parseNumberPair(
  args: (string | number)[],
  startIndex: number,
  firstName: string = 'first',
  secondName: string = 'second',
): ParsedNumberPair {
  // Case 1: Comma-separated in single argument - "7,10"
  if (startIndex < args.length && typeof args[startIndex] === 'string') {
    const arg = args[startIndex] as string;
    if (arg.includes(',')) {
      const parts = arg.split(',');
      if (parts.length !== 2) {
        return { success: false, error: `Expected format: "${firstName},${secondName}"` };
      }

      const [firstStr, secondStr] = parts;
      if (!firstStr || !secondStr) {
        return { success: false, error: `Missing ${firstName} or ${secondName}` };
      }

      const firstResult = parseNumberArg(firstStr, firstName);
      if (!firstResult.success) {
        return { success: false, error: (firstResult as { success: false; error: string; }).error };
      }

      const secondResult = parseNumberArg(secondStr, secondName);
      if (!secondResult.success) {
        return { success: false, error: (secondResult as { success: false; error: string; }).error };
      }

      return { success: true, first: firstResult.value, second: secondResult.value };
    }
  }

  // Case 2: Space-separated in two arguments - "7" "10"
  if (startIndex + 1 < args.length) {
    const firstArg = args[startIndex];
    const secondArg = args[startIndex + 1];

    if (firstArg === undefined || secondArg === undefined) {
      return { success: false, error: `Missing ${firstName} or ${secondName}` };
    }
    const firstResult = parseNumberArg(firstArg, firstName);
    if (!firstResult.success) {
      return { success: false, error: (firstResult as { success: false; error: string; }).error };
    }

    const secondResult = parseNumberArg(secondArg, secondName);
    if (!secondResult.success) {
      return { success: false, error: (secondResult as { success: false; error: string; }).error };
    }

    return { success: true, first: firstResult.value, second: secondResult.value };
  }

  return { success: false, error: `Expected either "${firstName},${secondName}" or "${firstName}" "${secondName}"` };
}

// Function to create the command handler with dependencies injected
export function createExecuteCommandHandler(
  connection: Connection,
  docs: LspDocuments,
  analyzer: Analyzer,
) {
  const showMessage = (message: string, type: MessageType = MessageType.Info) => {
    if (type === MessageType.Info) {
      connection.window.showInformationMessage(message);
      connection.sendNotification('window/showMessage', {
        message: message,
        type: MessageType.Info,
      });
      logger.info(message);
    } else {
      connection.window.showErrorMessage(message);
      connection.sendNotification('window/showMessage', {
        message: message,
        type: MessageType.Error,
      });
      logger.error(message);
    }
  };

  // Parse executeRange arguments with flexible position formats
  type ParsedExecuteRangeArgs =
    | { type: 'valid'; path: string; startLine: number; endLine: number; }
    | { type: 'invalid'; reason: string; };

  function parseExecuteRangeArgs(args: string[]): ParsedExecuteRangeArgs {
    // Need at least 2 args: path + range
    if (args.length < 2) {
      return { type: 'invalid', reason: 'Missing arguments (need path and line range)' };
    }

    const [pathArg, ...restArgs] = args;
    if (!pathArg) {
      return { type: 'invalid', reason: 'Missing path argument' };
    }

    // Parse the line range starting from index 0 of restArgs
    const pairResult = parseNumberPair(restArgs, 0, 'startLine', 'endLine');

    if (!pairResult.success) {
      return { type: 'invalid', reason: (pairResult as { success: false; error: string; }).error };
    }

    // TypeScript now knows pairResult.success is true
    return {
      type: 'valid',
      path: pathArg,
      startLine: pairResult.first,
      endLine: pairResult.second,
    };
  }

  async function executeRange(...args: string[]) {
    logger.log('executeRange called with args:', args);

    const parsed = parseExecuteRangeArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid executeRange arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.EXECUTE_RANGE, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    let { path } = parsed;
    const { startLine, endLine } = parsed; // Lines are 1-indexed from user

    // Expand path (handles ~, $ENV_VARS, etc.)
    path = SyncFileHelper.expandEnvVars(path);

  const showMessage = (message: string, type: MessageType = MessageType.Info) => {
    if (type === MessageType.Info) {
      connection.window.showInformationMessage(message);
      connection.sendNotification('window/showMessage', {
        message: message,
        type: MessageType.Info,
      });
      logger.info(message);
    } else {
      connection.window.showErrorMessage(message);
      connection.sendNotification('window/showMessage', {
        message: message,
        type: MessageType.Error,
      });
      logger.error(message);
    }
  };

  async function executeRange(path: string, startLine: number, endLine: number) {
    // could also do executeLine() on every line in the range
    const cached = analyzer.analyzePath(path);
    if (!cached) {
      showMessage(`File not found or could not be analyzed: ${path}`, MessageType.Error);
      return;
    }
    const { document } = cached;
    const current = document;
    if (!current) return;
    const start = current.getLineStart(toZeroIndexed(startLine));
    const end = current.getLineEnd(toZeroIndexed(endLine));
    const range = Range.create(start.line, start.character, end.line, end.character);
    logger.log('executeRange', current.uri, range);

    const text = current.getText(range);
    const output = (await execAsync(text)).stdout || '';

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    const response = buildExecuteNotificationResponse(text.split('\n').map(s => s.replace(/;\s?$/, '')).join('; '), { stdout: '\n' + output, stderr: '' });
    useMessageKind(connection, response);
  }

  // Parse executeLine arguments
  type ParsedExecuteLineArgs =
    | { type: 'valid'; path: string; line: number; }
    | { type: 'invalid'; reason: string; };

  function parseExecuteLineArgs(args: string[]): ParsedExecuteLineArgs {
    // Parse path (index 0)
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    // Parse line number (index 1)
    if (args.length < 2) {
      return { type: 'invalid', reason: 'Missing line number argument' };
    }
    const line = args[1];
    if (!line) {
      return { type: 'invalid', reason: 'Line number must be provided' };
    }

    const lineResult = parseNumberArg(line, 'line');
    if (!lineResult.success) {
      return { type: 'invalid', reason: (lineResult as { success: false; error: string; }).error };
    }

    return { type: 'valid', path: pathResult.path, line: lineResult.value };
  }

  async function executeLine(...args: string[]) {
    logger.log('executeLine called with args:', args);

    const parsed = parseExecuteLineArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid executeLine arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.EXECUTE_LINE, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path, line: lineNumber } = parsed; // Path already expanded by parsePathArg

    const cached = analyzer.analyzePath(path);
    if (!cached) {
      showMessage(`File not found or could not be analyzed: ${path}`, MessageType.Error);
      return;
    }
    const { document } = cached;
    logger.log('executeLine', document.uri, lineNumber);
    if (!document) return;

    const zeroIndexedLine = toZeroIndexed(lineNumber);

    const text = document.getLine(zeroIndexedLine);
    const cmdOutput = await execAsyncF(`${text}; echo "\\$status: $status"`);
    logger.log('executeLine.cmdOutput', cmdOutput);
    const output = buildExecuteNotificationResponse(text, { stdout: cmdOutput, stderr: '' });

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    // const response = buildExecuteNotificationResponse(text, );
    useMessageKind(connection, output);
  }

  // Parse createTheme arguments
  type ParsedCreateThemeArgs =
    | { type: 'valid'; path: string; asVariables: boolean; }
    | { type: 'invalid'; reason: string; };

  function parseCreateThemeArgs(args: string[]): ParsedCreateThemeArgs {
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    // Optional second argument for asVariables (default: true)
    let asVariables = true;
    if (args.length >= 2) {
      const asVarArg = args[1];
      // Accept various boolean representations (all args are strings from LSP)
      if (asVarArg === 'false' || asVarArg === '0') {
        asVariables = false;
      }
    }

    return { type: 'valid', path: pathResult.path, asVariables };
  }

  async function createTheme(...args: string[]) {
    logger.log('createTheme called with args:', args);

    const parsed = parseCreateThemeArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid createTheme arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.CREATE_THEME, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path, asVariables } = parsed; // Path already expanded by parsePathArg

    const cached = analyzer.analyzePath(path);
    if (!cached) return;
    const { document } = cached;
    const output = (await execAsyncFish('fish_config theme dump; or true')).stdout.split('\n');

    if (!document) {
      logger.error('createTheme', 'Document not found');
      connection.sendNotification('window/showMessage', {
        message: ` Document not found: ${uriToReadablePath(pathToUri(path))} `,
        type: MessageType.Error,
      });
      return;
    }
    const outputArr: string[] = [];
    // Append the longest line to the file
    if (asVariables) {
      outputArr.push('\n\n# created by fish-lsp');
    }
    for (const line of output) {
      if (asVariables) {
        outputArr.push(`set -gx ${line}`);
      } else {
        outputArr.push(`${line}`);
      }
    }
    const outputStr = outputArr.join('\n');
    const docsEnd = document.positionAt(document.getLines());
    const workspaceEdit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(docsEnd, outputStr),
        ],
      },
    };
    await connection.workspace.applyEdit(workspaceEdit);
    await connection.sendRequest('window/showDocument', {
      uri: document.uri,
      takeFocus: true,
    });

    useMessageKind(connection, {
      message: `${fishLspPromptIcon} appended theme variables to end of file`,
      kind: 'info',
    });
  }

  // Parse executeBuffer arguments
  type ParsedExecuteBufferArgs =
    | { type: 'valid'; path: string; }
    | { type: 'invalid'; reason: string; };

  function parseExecuteBufferArgs(args: string[]): ParsedExecuteBufferArgs {
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    return { type: 'valid', path: pathResult.path };
  }

  async function executeBuffer(...args: string[]) {
    logger.log('executeBuffer called with args:', args);

    const parsed = parseExecuteBufferArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid executeBuffer arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.EXECUTE_BUFFER, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path } = parsed; // Path already expanded by parsePathArg

    const output = await execEntireBuffer(path);
    // Append the longest line to the file
    useMessageKind(connection, output);
  }

  function handleShowStatusDocs(statusCode?: string | number) {
    if (!statusCode) {
      logger.log('handleShowStatusDocs', 'No status code provided');
      showMessage('No status code provided', MessageType.Error);
      return;
    }
    if (typeof statusCode === 'string' && statusCode.startsWith("'") && statusCode.endsWith("'")) {
      statusCode = statusCode.slice(1, -1).toString();
      logger.log('handleShowStatusDocs', 'statusCode is string', statusCode);
    }
    statusCode = Number.parseInt(statusCode.toString()).toString();
    const statusInfo = PrebuiltDocumentationMap.getByType('status')
      .find(item => item.name === statusCode);

    logger.log('handleShowStatusDocs', statusCode, {
      foundStatusInfo: PrebuiltDocumentationMap.getByType('status').map(item => item.name),
      statusParam: statusCode,
      statusInfoFound: statusInfo,
    });

    if (statusInfo) {
      let docMessage = `Status Code: ${statusInfo.name}\n\n`;
      const description = statusInfo.description.split(' ');
      let lineLen = 0;
      for (let i = 0; i < description.length; i++) {
        const word = description[i];
        if (!word) continue;
        if (lineLen + word?.length > 80) {
          docMessage += '\n' + word;
          lineLen = 0;
          continue;
        } else if (lineLen === 0) {
          docMessage += word;
          lineLen += word.length;
        } else {
          docMessage += ' ' + word;
          lineLen += word.length + 1;
        }
      }
      showMessage(docMessage, MessageType.Info);
    } else {
      showMessage(`No documentation found for status code: ${statusCode}`, MessageType.Error);
    }
  }

  function showWorkspaceMessage() {
    const message = `${fishLspPromptIcon} Workspace: ${workspaceManager.current?.name}\n\n Total files analyzed: ${workspaceManager.current?.uris.indexedCount}`;
    logger.log('showWorkspaceMessage',
      config,
    );
    // Using the notification method directly
    // connection.window.showInformationMessage(message);
    // connection.sendNotification('window/showMessage', {
    //   message: message,
    //   type: MessageType.Info,
    // });
    showMessage(message, MessageType.Info);
    return undefined;
  }

  // Parse _updateWorkspace arguments
  type ParsedUpdateWorkspaceArgs =
    | { type: 'valid'; path: string; flags: string[]; }
    | { type: 'invalid'; reason: string; };

  function parseUpdateWorkspaceArgs(args: string[]): ParsedUpdateWorkspaceArgs {
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    // Remaining args are flags
    const flags = args.slice(1);

    return { type: 'valid', path: pathResult.path, flags };
  }

  async function _updateWorkspace(...args: string[]) {
    logger.log('_updateWorkspace called with args:', args);

    const parsed = parseUpdateWorkspaceArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid _updateWorkspace arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.UPDATE_WORKSPACE, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path, flags } = parsed; // Path already expanded by parsePathArg
    const silence = flags.includes('--quiet') || flags.includes('-q');

    const uri = pathToUri(path);
    workspaceManager.handleUpdateDocument(uri);
    const message = `${fishLspPromptIcon} Workspace: ${workspaceManager.current?.path}`;
    connection.sendNotification('workspace/didChangeWorkspaceFolders', {
      event: {
        added: [path],
        removed: [],
      },
    });

    if (silence) return undefined;

    // Using the notification method directly
    // connection.sendNotification('window/showMessage', {
    //   message: message,
    //   type: MessageType.Info,
    // });
    showMessage(message, MessageType.Info);
    return undefined;
  }

  // Parse fixAllDiagnostics arguments
  type ParsedFixAllDiagnosticsArgs =
    | { type: 'valid'; path: string; }
    | { type: 'invalid'; reason: string; };

  function parseFixAllDiagnosticsArgs(args: string[]): ParsedFixAllDiagnosticsArgs {
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    return { type: 'valid', path: pathResult.path };
  }

  async function fixAllDiagnostics(...args: string[]) {
    logger.log('fixAllDiagnostics called with args:', args);

    const parsed = parseFixAllDiagnosticsArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid fixAllDiagnostics arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.FIX_ALL, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path } = parsed; // Path already expanded by parsePathArg

    const uri = pathToUri(path);
    logger.log('fixAllDiagnostics', uri);
    const cached = analyzer.analyzePath(path);
    if (!cached) {
      showMessage(`File not found or could not be analyzed: ${path}`, MessageType.Error);
      return;
    }
    const { document } = cached;
    const root = analyzer.getRootNode(uri);
    if (!document || !root) return;
    const diagnostics = root ? getDiagnostics(root, document) : [];

    logger.warning('fixAllDiagnostics', diagnostics.length, 'diagnostics found');
    if (diagnostics.length === 0) {
      logger.log('No diagnostics found');
      return;
    }

    const { onCodeAction } = codeActionHandlers(docs, analyzer);

    const actions = await onCodeAction({
      textDocument: document.asTextDocumentIdentifier(),
      range: getRange(root),
      context: {
        diagnostics: diagnostics,
      },
    });
    logger.log('fixAllDiagnostics', actions);
    const fixAllAction = createFixAllAction(document, actions);
    if (!fixAllAction) {
      logger.log('fixAllDiagnostics did not find any fixAll actions');
      return;
    }
    const fixCount = fixAllAction?.data.totalEdits || 0;
    if (fixCount > 0) {
      logger.log('fixAllDiagnostics', `Can apply ${fixCount} fixes`);
      const result = await connection.window.showInformationMessage(
        `Fix all ${fixAllAction.data.totalEdits} diagnostics on ${uriToReadablePath(uri)}`,
        { title: 'Yes' },
        { title: 'Cancel' },
      );
      const { title } = result?.title ? result : { title: 'Cancel' };
      if (title === 'Cancel') {
        connection.sendNotification('window/showMessage', {
          type: MessageType.Info,  // Info, Warning, Error, Log
          message: ' No changes were made to the file. ',
        });
        return;
      }
      // Apply all edits
      const workspaceEdit = fixAllAction.edit;
      if (!workspaceEdit) return;
      await connection.workspace.applyEdit(workspaceEdit);
      connection.sendNotification('window/showMessage', {
        type: MessageType.Info,  // Info, Warning, Error, Log
        message: ` Applied ${fixCount} quick fixes `,
      });
    }
  }

  function toggleSingleWorkspaceSupport() {
    const currentConfig = config.fish_lsp_single_workspace_support;
    config.fish_lsp_single_workspace_support = !currentConfig;
    connection.sendNotification('window/showMessage', {
      type: MessageType.Info,  // Info, Warning, Error, Log
      message: ` Single workspace support: ${config.fish_lsp_single_workspace_support ? 'ENABLED' : 'DISABLED'} `,
    });
  }

  // Parse outputFishLspEnv arguments
  type ParsedOutputFishLspEnvArgs =
    | { type: 'valid'; path: string; }
    | { type: 'invalid'; reason: string; };

  function parseOutputFishLspEnvArgs(args: string[]): ParsedOutputFishLspEnvArgs {
    const pathResult = parsePathArg(args, 0);

    if (!pathResult.success) {
      return { type: 'invalid', reason: (pathResult as { success: false; error: string; }).error };
    }

    return { type: 'valid', path: pathResult.path };
  }

  const envOutputOptions = {
    confd: false,
    comments: true,
    global: true,
    local: false,
    export: true,
    json: false,
    only: undefined,
  };

  function outputFishLspEnv(...args: string[]) {
    logger.log('outputFishLspEnv called with args:', args);

    const parsed = parseOutputFishLspEnvArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid outputFishLspEnv arguments:', { args, reason: parsed.reason });
      showMessage(
        formatCommandHelp(CommandNames.GENERATE_ENV_VARIABLES, parsed.reason),
        MessageType.Error,
      );
      return;
    }

    const { path } = parsed; // Path already expanded by parsePathArg
    const cached = analyzer.analyzePath(path);
    if (!cached) return;
    const { document } = cached;
    if (!document) return;
    const output: string[] = ['\n'];
    const outputCallback = (s: string) => {
      output.push(s);
    };
    handleEnvOutput('show', outputCallback, {
      confd: false,
      comments: true,
      global: true,
      local: false,
      export: true,
      json: false,
      only: undefined,
    });
    showMessage(`${fishLspPromptIcon} Appending fish-lsp environment variables to the end of the file`, MessageType.Info);
    const docsEnd = document.positionAt(document.getLines());
    const workspaceEdit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(docsEnd, output.join('\n')),
        ],
      },
    };
    connection.workspace.applyEdit(workspaceEdit);
  }

  async function showReferences(path: string = '/home/ndonfris/.config/fish/config.fish', references: Location[] = []) {
    const uri = pathToUri(path);

    const res1 = await connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: {
        line: 7,
        character: 13,
      },
    });

    showMessage(` Fish LSP sent textDocument/references notification ${res1}`, MessageType.Info);

    const resp = await connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: {
        line: 7,
        character: 13,
      },
    });
    logger.debug({
      showReferences_resp: resp,
      path,
      positions: references,
    });

    // logger.log('handleShowReferences', { path, uri, position, references });
    connection.sendNotification('window/showMessage', {
      type: MessageType.Info,  // Info, Warning, Error, Log
      message: ` Fish LSP found ${references.length} references to this symbol `,
    });
    showMessage(` Fish LSP found ${references.length} references to this symbol `, MessageType.Info);
    return references;
  }

  function showEnvVariables(...opts: string[]) {
    if (!opts.some(o => ['all', 'changed', 'default', 'unchanged'].includes(o))) {
      opts = ['all', ...opts];
    }
    const mode = opts[0] || 'all';
    const noComments: boolean = opts.find(o => o === '--no-comments') ? true : false;
    const noValues: boolean = opts.find(o => o === '--no-values') ? true : false;
    const asJson: boolean = opts.find(o => o === '--json') ? true : false;

    let variables = PrebuiltDocumentationMap
      .getByType('variable', 'fishlsp')
      .filter((v) => EnvVariableJson.is(v) ? !v.isDeprecated : false)
      .map(v => v as EnvVariableJson);

    const allVars = variables;
    const changedVars = variables.filter(v => env.has(v.name));
    const unchangedVars = allVars.filter(v => !changedVars.map(c => c.name).includes(v.name));
    const defaultVars = variables.filter(v => {
      const defConfig = getDefaultConfiguration();
      return v.name in defConfig;
    });

    const defaultConfig = getDefaultConfiguration();

    let resVars: EnvVariableJson[] = [];
    if (mode === 'all') {
      resVars = allVars;
    } else if (mode === 'changed') {
      resVars = variables.filter(v => env.has(v.name));
    } else if (mode === 'unchanged') {
      resVars = variables.filter(v => !changedVars.map(c => c.name).includes(v.name));
    } else if (mode === 'default') {
      variables = Object.entries(getDefaultConfiguration()).map(([key, _]) => {
        const EnvVar = variables.find(v => v.name === key);
        if (EnvVar) return EnvVar;
      }).filter((v): v is EnvVariableJson => v !== undefined);
      resVars = variables.filter((v): v is EnvVariableJson => v !== undefined);
    }

    const logArr = (resVars: EnvVariableJson[]) => ({
      names: resVars.map(v => v.name),
      len: resVars.length,
    });

    logger.log('showEnvVariables', {
      totalVariables: variables.length,
      all: logArr(allVars),
      changedVariables: logArr(changedVars),
      unchangedVariables: logArr(unchangedVars),
      defaultVariables: logArr(defaultVars),
    });

    if (asJson) {
      const results: Record<Config.ConfigKeyType, Config.ConfigValueType> = {} as Record<Config.ConfigKeyType, Config.ConfigValueType>;
      resVars.forEach(v => {
        const { name } = v as { name: Config.ConfigKeyType; };
        if (!name || !(name in config)) return;
        if (mode === 'default') results[name] = defaultConfig[name];
        else results[name] = config[name];
      });
      showMessage(
        [
          '\n{',
          Object.entries(results).map(([key, value]) => {
            const k = JSON.stringify(key);
            const v = JSON.stringify(value).replaceAll('\n', ' ').trim() + ',';
            return `  ${k}: ${v}`;
          }).join('\n'),
          '}',
        ].join('\n'),
        MessageType.Info,
      );
      return;
    }

    const filteredAllVars = (vals: EnvVariableJson[]) => {
      const res = vals.map(v => {
        const value = noValues ? '' : EnvVariableTransformers.convertValueToShellOutput(config[v.name as Config.ConfigKeyType]);
        const comment = noComments ? '' : `# ${v.description.replace(/\n/g, ' ')}\n`;
        if (noValues && noComments) return `${v.name}`;
        return `${comment}set ${v.name} ${value}\n`;
      });
      return res.join('\n');
    };

    let message = '\n';
    if (mode === 'all' || !mode) {
      message += filteredAllVars(allVars);
    } else if (mode === 'changed') {
      message += filteredAllVars(changedVars);
    } else if (mode === 'unchanged') {
      message += filteredAllVars(unchangedVars);
    } else if (mode === 'default') {
      message += filteredAllVars(defaultVars);
    }

    showMessage(message.trimEnd(), MessageType.Info);
  }

  function showInfo() {
    const message = JSON.stringify({
      version: PkgJson.version,
      buildTime: PkgJson.buildTime,
      repo: PkgJson.path,
    }, null, 2);
    showMessage(message, MessageType.Info);
  }

  // Command handler mapping
  const commandHandlers: Record<string, (...args: any[]) => Promise<void> | void | Promise<Location[]>> = {
    // 'fish-lsp.showReferences': handleShowReferences,
    'fish-lsp.executeRange': executeRange,
    'fish-lsp.executeLine': executeLine,
    'fish-lsp.executeBuffer': executeBuffer,
    'fish-lsp.execute': executeBuffer,
    'fish-lsp.createTheme': createTheme,
    'fish-lsp.showStatusDocs': handleShowStatusDocs,
    'fish-lsp.showWorkspaceMessage': showWorkspaceMessage,
    'fish-lsp.updateWorkspace': _updateWorkspace,
    'fish-lsp.fixAll': fixAllDiagnostics,
    'fish-lsp.toggleSingleWorkspaceSupport': toggleSingleWorkspaceSupport,
    'fish-lsp.generateEnvVariables': outputFishLspEnv,
    'fish-lsp.showEnvVariables': showEnvVariables,
    'fish-lsp.showReferences': showReferences,
    'fish-lsp.showInfo': showInfo,
  };

  // Main command handler function
  return async function onExecuteCommand(params: ExecuteCommandParams): Promise<void> {
    logger.log('onExecuteCommand', params);

    const handler = commandHandlers[params.command];
    if (!handler) {
      logger.log(`Unknown command: ${params.command}`);
      return;
    }

    await handler(...params.arguments || []);
  };
}
