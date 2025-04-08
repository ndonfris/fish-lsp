import { Connection, ExecuteCommandParams, Range } from 'vscode-languageserver';
import { Logger } from './logger';
import { LspDocuments } from './document';
import { execAsyncF, execAsyncFish } from './utils/exec';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { buildExecuteNotificationResponse, execEntireBuffer, fishLspPromptIcon, useMessageKind } from './execute-handler';

// Define command name constants to avoid string literals
export const CommandNames = {
  EXECUTE_RANGE: 'fish-lsp.executeRange',
  EXECUTE_LINE: 'fish-lsp.executeLine',
  EXECUTE: 'fish-lsp.execute',
  EXECUTE_BUFFER: 'fish-lsp.executeBuffer',
  CREATE_THEME: 'fish-lsp.createTheme',
  SHOW_STATUS_DOCS: 'fish-lsp.showStatusDocs',
} as const;

export const LspCommands = [...Array.from(Object.values(CommandNames))];

export type CommandName = typeof CommandNames[keyof typeof CommandNames];

// Type for command arguments
export type CommandArgs = {
  // [CommandNames.SHOW_REFERENCES]: [uri: string, position: Position, references: Location[]];
  [CommandNames.EXECUTE_RANGE]: [uri: string, range: Range];
  [CommandNames.EXECUTE_LINE]: [uri: string, line: number];
  [CommandNames.EXECUTE]: [path: string];
  [CommandNames.EXECUTE_BUFFER]: [path: string];
  [CommandNames.CREATE_THEME]: [themeName: string, asVariables?: boolean];
  [CommandNames.SHOW_STATUS_DOCS]: [statusCode: string];
};

// Function to create the command handler with dependencies injected
export function createExecuteCommandHandler(
  connection: Connection,
  docs: LspDocuments,
  logger: Logger,
) {
  async function executeRange(uri: string, range: Range) {
    logger.log('executeRange', uri, range);
    const doc = docs.get(uri);
    if (!doc) return;

    const text = doc.getText(range);
    const output = await execAsyncF(text);

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    const response = buildExecuteNotificationResponse(text, { stdout: output, stderr: '' });
    useMessageKind(connection, response);
  }

  async function executeLine(uri: string, line: number) {
    logger.log('executeLine', uri, line);
    const doc = docs.get(uri);
    if (!doc) return;

    const numberLine = Number.parseInt(line.toString()) - 1;

    const text = doc.getLine(numberLine);
    const cmdOutput = await execAsyncF(`${text}; echo "\\$status: $status"`);
    logger.log('executeLine.cmdOutput', cmdOutput);
    const output = buildExecuteNotificationResponse(text, { stdout: cmdOutput, stderr: '' });

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    // const response = buildExecuteNotificationResponse(text, );
    useMessageKind(connection, output);
  }

  async function createTheme(themeName: string, asVariables: boolean = true) {
    const path = `~/.config/fish/themes/${themeName}.fish`;
    const output = (await execAsyncFish('fish_config theme dump; or true')).stdout.split('\n');

    const outputArr: string[] = [];
    // Append the longest line to the file
    if (asVariables) {
      outputArr.push('# created by fish-lsp');
    }
    for (const line of output) {
      if (asVariables) {
        outputArr.push(`set -gx ${line}`);
      } else {
        outputArr.push(`${line}`);
      }
    }
    const outputStr = outputArr.join('\n');
    await connection.sendRequest('workspace/applyEdit', {
      changes: {
        [path]: outputStr,
      },
    });

    await connection.sendRequest('window/showDocument', {
      uri: `file://${path}`,
      takeFocus: true,
    });

    useMessageKind(connection, {
      message: `${fishLspPromptIcon} appended theme variables to end of file`,
      kind: 'info',
    });
  }

  async function executeBuffer(path: string) {
    const output = await execEntireBuffer(path);
    // Append the longest line to the file
    useMessageKind(connection, output);
  }

  function handleShowStatusDocs(statusCode: string) {
    const statusInfo = PrebuiltDocumentationMap.getByType('status')
      .find(item => item.name === statusCode);

    if (statusInfo) {
      connection.window.showInformationMessage(statusInfo.description);
    }
  }

  // Command handler mapping
  const commandHandlers: Record<string, (...args: any[]) => Promise<void> | void> = {
    // 'fish-lsp.showReferences': handleShowReferences,
    'fish-lsp.executeRange': executeRange,
    'fish-lsp.executeLine': executeLine,
    'fish-lsp.executeBuffer': executeBuffer,
    'fish-lsp.execute': executeBuffer,
    'fish-lsp.createTheme': createTheme,
    'fish-lsp.showStatusDocs': handleShowStatusDocs,
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
