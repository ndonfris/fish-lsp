import { Connection, ExecuteCommandParams, MessageType, Position, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { codeActionHandlers } from './code-actions/code-action-handler';
import { createFixAllAction } from './code-actions/quick-fixes';
import { config, handleEnvOutput } from './config';
import { getDiagnostics } from './diagnostics/validate';
import { LspDocuments } from './document';
import { buildExecuteNotificationResponse, execEntireBuffer, fishLspPromptIcon, useMessageKind } from './execute-handler';
import { logger } from './logger';
import { env } from './utils/env-manager';
import { execAsync, execAsyncF, execAsyncFish } from './utils/exec';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { pathToUri, uriToReadablePath } from './utils/translation';
import { getRange } from './utils/tree-sitter';
import { workspaceManager } from './utils/workspace-manager';
import { PkgJson } from './utils/commander-cli-subcommands';

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
  CHECK_HEALTH: 'fish-lsp.checkHealth',
  SHOW_REFERENCES: 'fish-lsp.showReferences',
  SHOW_INFO: 'fish-lsp.showInfo',
} as const;

export const LspCommands = [...Array.from(Object.values(CommandNames))];

export type CommandName = typeof CommandNames[keyof typeof CommandNames];

// Type for command arguments
export type CommandArgs = {
  // [CommandNames.SHOW_REFERENCES]: [uri: string, position: Position, references: Location[]];
  [CommandNames.EXECUTE_RANGE]: [path: string, startLine: number, endLine: number];
  [CommandNames.EXECUTE_LINE]: [path: string, line: number];
  [CommandNames.EXECUTE]: [path: string];
  [CommandNames.EXECUTE_BUFFER]: [path: string];
  [CommandNames.CREATE_THEME]: [path: string, asVariables?: boolean];
  [CommandNames.SHOW_STATUS_DOCS]: [statusCode: string];
  [CommandNames.SHOW_WORKSPACE_MESSAGE]: [];
  [CommandNames.UPDATE_WORKSPACE]: [path: string];
  [CommandNames.FIX_ALL]: [path: string];
  [CommandNames.TOGGLE_SINGLE_WORKSPACE_SUPPORT]: [];
  [CommandNames.GENERATE_ENV_VARIABLES]: [path: string];
  [CommandNames.SHOW_REFERENCES]: [path: string, position: Position, references: Location[]];  // Add this line
  [CommandNames.SHOW_INFO]: [];
};

// Function to create the command handler with dependencies injected
export function createExecuteCommandHandler(
  connection: Connection,
  docs: LspDocuments,
  analyzer: Analyzer,
) {
  // const codeActionHandler = createCodeActionHandler(docs, analyzer);

  async function executeRange(path: string, startLine: number, endLine: number) {
    // could also do executeLine() on every line in the range
    const cached = analyzer.analyzePath(path);
    if (!cached) return;
    const { document } = cached;
    const current = document;
    if (!current) return;
    const start = current.getLineStart(startLine - 1);
    const end = current.getLineEnd(endLine - 1);
    const range = Range.create(start.line, start.character, end.line, end.character);
    logger.log('executeRange', current.uri, range);

    const text = current.getText(range);
    const output = (await execAsync(text)).stdout || '';

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    const response = buildExecuteNotificationResponse(text.split('\n').map(s => s.replace(/;\s?$/, '')).join('; '), { stdout: '\n' + output, stderr: '' });
    useMessageKind(connection, response);
  }

  async function executeLine(path: string, line: number) {
    const cached = analyzer.analyzePath(path);
    if (!cached) return;
    const { document } = cached;
    logger.log('executeLine', document.uri, line);
    if (!document) return;

    const numberLine = Number.parseInt(line.toString()) - 1;

    const text = document.getLine(numberLine);
    const cmdOutput = await execAsyncF(`${text}; echo "\\$status: $status"`);
    logger.log('executeLine.cmdOutput', cmdOutput);
    const output = buildExecuteNotificationResponse(text, { stdout: cmdOutput, stderr: '' });

    logger.log('onExecuteCommand', text);
    logger.log('onExecuteCommand', output);
    // const response = buildExecuteNotificationResponse(text, );
    useMessageKind(connection, output);
  }

  async function createTheme(path: string, asVariables: boolean = true) {
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

  function showWorkspaceMessage() {
    const message = `${fishLspPromptIcon} Workspace: ${workspaceManager.current?.name}\n\n Total files analyzed: ${workspaceManager.current?.uris.indexedCount}`;
    logger.log('showWorkspaceMessage',
      config,
    );
    // Using the notification method directly
    connection.sendNotification('window/showMessage', {
      message: message,
      type: MessageType.Info,
    });
    return undefined;
  }

  async function _updateWorkspace(path: string, ...args: string[]) {
    const silence = args.includes('--quiet') || args.includes('-q');

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
    connection.sendNotification('window/showMessage', {
      message: message,
      type: MessageType.Info,
    });
    return undefined;
  }

  async function updateConfig(path: string) {
    const cached = analyzer.analyzePath(path);
    if (!cached) return;
    const { document } = cached;
    if (!document) return;
    analyzer.updateConfigInWorkspace(document.uri);
    connection.sendNotification('window/showMessage', {
      message: config,
      type: MessageType.Info,
    });
    return undefined;
  }

  async function fixAllDiagnostics(path: string) {
    const uri = pathToUri(path);
    logger.log('fixAllDiagnostics', uri);
    const cached = analyzer.analyzePath(path);
    if (!cached) return;
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

  function outputFishLspEnv(path: string) {
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
      only: undefined,
    });
    connection.sendNotification('window/showMessage', {
      type: MessageType.Info,  // Info, Warning, Error, Log
      message: ` Fish LSP Environment Variables: \n ${env.getAutoloadedKeys().join('\n')} `,
    });
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

  async function showReferences(path: string, position: Position, references: Location[]) {
    const uri = pathToUri(path);
    logger.log('handleShowReferences', { path, uri, position, references });
    connection.sendNotification('window/showMessage', {
      type: MessageType.Info,  // Info, Warning, Error, Log
      message: ` Fish LSP found ${references.length} references to this symbol `,
    });
    return references;
  }

  function showInfo() {
    const message = JSON.stringify({
      version: PkgJson.version,
      buildTime: PkgJson.buildTime,
      repo: PkgJson.repo,
    }, null, 2);
    if (config.fish_lsp_show_client_popups) {
      connection.window.showInformationMessage(message);
    } else {
      connection.sendNotification('window/showMessage', {
        type: MessageType.Info,  // Info, Warning, Error, Log
        message: message,
      });
      logger.log('showInfo', message);
    }
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
    'fish-lsp.updateConfig': updateConfig,
    'fish-lsp.fixAll': fixAllDiagnostics,
    'fish-lsp.toggleSingleWorkspaceSupport': toggleSingleWorkspaceSupport,
    'fish-lsp.generateEnvVariables': outputFishLspEnv,
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
