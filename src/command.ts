import { Connection, ExecuteCommandParams, Range } from 'vscode-languageserver';
import { Logger } from './logger';
import { LspDocuments } from './document';
import { execAsyncF, execAsyncFish } from './utils/exec';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { buildExecuteNotificationResponse, execEntireBuffer, fishLspPromptIcon, useMessageKind } from './execute-handler';

// Define command name constants to avoid string literals
export const CommandNames = {
  // SHOW_REFERENCES: 'fish-lsp.showReferences',
  EXECUTE_RANGE: 'fish-lsp.executeRange',
  EXECUTE_LINE: 'fish-lsp.executeLine',
  EXECUTE: 'fish-lsp.execute',
  EXECUTE_BUFFER: 'fish-lsp.executeBuffer',
  CREATE_THEME: 'fish-lsp.createTheme',
  // OPEN_SAVED_FUNCTION: 'fish-lsp.openSavedFunction',
  // OPEN_COMPLETIONS: 'fish-lsp.openCompletions',
  // RUN_TEST: 'fish-lsp.runTest',
  SHOW_STATUS_DOCS: 'fish-lsp.showStatusDocs',
  // OPEN_SOURCE: 'fish-lsp.openSource',
  // SHOW_COMMAND_DOCS: 'fish-lsp.showCommandDocs',
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
  // [CommandNames.OPEN_SAVED_FUNCTION]: [path: string];
  // [CommandNames.OPEN_COMPLETIONS]: [path: string];
  // [CommandNames.RUN_TEST]: [uri: string, range: Range];
  [CommandNames.SHOW_STATUS_DOCS]: [statusCode: string];
  // [CommandNames.OPEN_SOURCE]: [sourcePath: string];
  // [CommandNames.SHOW_COMMAND_DOCS]: [commandName: string];
};

// Function to create the command handler with dependencies injected
export function createExecuteCommandHandler(
  connection: Connection,
  docs: LspDocuments,
  logger: Logger,
) {
  // Individual command implementations
  // async function handleShowReferences(uri: string, position: Position, references: Location[]) {
  //   await connection.sendRequest('textDocument/references', {
  //     textDocument: { uri },
  //     position,
  //     context: { includeDeclaration: true }
  //   });
  // }
  //
  // async function openSavedFunction(path: string) {
  //   await connection.sendRequest('window/showDocument', {
  //     uri: `file://${path}`,
  //     takeFocus: true,
  //   });
  // }

  // async function openCompletions(path: string) {
  //   let commandName = path;
  //
  //   if (path.endsWith('.fish')) {
  //     commandName = path.split('/').pop() || commandName;
  //     commandName = commandName?.split('.fish').at(0) || commandName;
  //   }
  //   const results = (await execAsyncF(`path sort --unique --key=basename $fish_complete_path/*.fish | string match -e '/${commandName}.fish'`)).split('\n');
  //   for (const result of results) {
  //     await connection.sendRequest('window/showDocument', {
  //       uri: `file://${result}`,
  //       takeFocus: true,
  //     });
  //   }
  // }

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

  // async function handleRunTest(uri: string, range: Range) {
  //   const doc = docs.get(uri);
  //   if (!doc) return;
  //
  //   const functionText = doc.getText(range);
  //   const output = await execAsyncFish(functionText);
  //
  //   if (output.stderr) {
  //     connection.window.showErrorMessage(`Test failed: ${output.stderr}`);
  //   } else {
  //     connection.window.showInformationMessage(`Test passed: ${output.stdout}`);
  //   }
  // }

  function handleShowStatusDocs(statusCode: string) {
    const statusInfo = PrebuiltDocumentationMap.getByType('status')
      .find(item => item.name === statusCode);

    if (statusInfo) {
      connection.window.showInformationMessage(statusInfo.description);
    }
  }

  // async function handleOpenSource(sourcePath: string) {
  //   // await connection.workspace.getWorkspaceFolders()
  //   await connection.sendRequest('workspace/openFile', {
  //     uri: pathToUri(sourcePath)
  //   });
  // }
  //
  // async function handleShowCommandDocs(commandName: string) {
  //   const docs = await execCommandDocs(commandName);
  //   if (docs) {
  //     connection.window.showInformationMessage(docs);
  //   }
  // }

  // Command handler mapping
  const commandHandlers: Record<string, (...args: any[]) => Promise<void> | void> = {
    // 'fish-lsp.showReferences': handleShowReferences,
    'fish-lsp.executeRange': executeRange,
    'fish-lsp.executeLine': executeLine,
    'fish-lsp.executeBuffer': executeBuffer,
    'fish-lsp.execute': executeBuffer,
    'fish-lsp.createTheme': createTheme,
    // 'fish-lsp.openSavedFunction': openSavedFunction,
    // 'fish-lsp.openCompletions': openCompletions,
    // 'fish-lsp.runTest': handleRunTest,
    'fish-lsp.showStatusDocs': handleShowStatusDocs,
    // 'fish-lsp.openSource': handleOpenSource,
    // 'fish-lsp.showCommandDocs': handleShowCommandDocs,
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
