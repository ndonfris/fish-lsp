import { Connection, ExecuteCommandParams, MessageType, Position, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { codeActionHandlers } from './code-actions/code-action-handler';
import { createFixAllAction } from './code-actions/quick-fixes';
import { config, generateJsonSchemaShellScript } from './config';
import { getDiagnostics } from './diagnostics/validate';
import { LspDocuments } from './document';
import { buildExecuteNotificationResponse, execEntireBuffer, fishLspPromptIcon, useMessageKind } from './execute-handler';
import { logger } from './logger';
import { env } from './utils/env-manager';
import { execAsync, execAsyncF, execAsyncFish } from './utils/exec';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { pathToUri, uriToReadablePath } from './utils/translation';
import { getRange } from './utils/tree-sitter';
import { currentWorkspace } from './utils/workspace';

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
    const { document } = analyzer.analyzePath(path);
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
    const { document } = analyzer.analyzePath(path);
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
    const { document } = analyzer.analyzePath(path);
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
    const message = `${fishLspPromptIcon} Workspace: ${currentWorkspace.current?.path}`;
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

  async function _updateWorkspace(path: string) {
    const uri = pathToUri(path);
    currentWorkspace.updateCurrentWorkspace(uri);
    const message = `${fishLspPromptIcon} Workspace: ${currentWorkspace.current?.path}`;
    connection.sendNotification('workspace/didChangeWorkspaceFolders', {
      event: {
        added: [path],
        removed: [],
      },
    });

    // Using the notification method directly
    connection.sendNotification('window/showMessage', {
      message: message,
      type: MessageType.Info,
    });
    return undefined;
  }

  // async function updateConfig() {
  //   for (const uri of analyzer.cache.uris()) {
  //     const doc = docs.get(uri);
  //     if (!doc) continue;
  //
  //     const symbols = analyzer.getFlatDocumentSymbols(uri);
  //     const autoloaded = symbols.filter(s => env.isAutoloaded(s.name));
  //     const autoloadedMap: Record<string, string[]> = {};
  //     if (autoloaded.length > 0) {
  //       const autoloadedNames = autoloaded.map(s => s.name).join(', ');
  //       logger.log(`Found auto-loaded functions: ${autoloadedNames}`);
  //       autoloaded.map((s, i) => {
  //         const defaultValue = autoloadedMap[s.name] || [];
  //         autoloadedMap[s.name] = [s.node.text, ...defaultValue];
  //         logger.debug({ i, s: autoloadedMap[s.name] });
  //       });
  //     }
  //
  //     for (const key in autoloadedMap) {
  //       if (Object.keys(ConfigSchema.shape).includes(key)) {
  //         const k = key as keyof typeof ConfigSchema.shape;
  //         (config[k] as any) = autoloadedMap[key]!.join(' ');
  //
  //       }
  //     }
  //
  //     const autoloadedStr = Object.entries(autoloadedMap)
  //       .map(([key, value]) => `${key} ${value.join(' ')}`)
  //       .join('\n');
  //     const output = await execAsyncFish(autoloadedStr);
  //   }

  async function updateConfig(path: string) {
    // Collect all autoloaded function names from open documents
    // const autoloadedFunctions: string[] = [];
    //
    // for (const uri of analyzer.cache.uris()) {
    //   const doc = docs.get(uri);
    //   if (!doc) continue;
    //
    //   const symbols = analyzer.getFlatDocumentSymbols(uri);
    //   const autoloaded = symbols.filter(s => env.isAutoloaded(s.name));
    //
    //   if (autoloaded.length > 0) {
    //     autoloadedFunctions.push(...autoloaded.map(s => s.name));
    //     logger.log(`Found autoloaded functions: ${autoloaded.map(s => s.name).join(', ')}`);
    //   }
    // }
    //
    // // If we found autoloaded functions, run fish command to generate environment settings
    // if (autoloadedFunctions.length > 0) {
    //   try {
    //     // Generate a fish command to output environment variables based on autoloaded functions
    //     const fishCommand = `
    //     for func in ${autoloadedFunctions.join(' ')}
    //       # Get function path
    //       set -l func_path (functions --details $func)
    //       # Get variables used in the function
    //       set -l vars (string match -r '\\$([a-zA-Z0-9_]+)' (functions $func) | string replace -r '\\$' '')
    //       echo "export fish_lsp_function_$func=(functions --details $func)"
    //       for var in $vars
    //         # Check if the variable exists and is a config variable
    //         if string match -q 'fish_lsp_*' $var
    //           echo "export $var=$$var"
    //         end
    //       end
    //     end
    //   `;
    //
    //     // Execute fish command to generate environment settings
    //     const { stdout } = await execAsyncFish(fishCommand);
    //
    //     // Parse the output to get environment settings
    //     const envSettings = stdout.split('\n')
    //       .filter(line => line.startsWith('export fish_lsp_'))
    //       .reduce((acc, line) => {
    //         const [_, varName, varValue] = line.match(/export (fish_lsp_\w+)=(.*)/) || [];
    //         if (varName && varValue) {
    //           acc[varName] = varValue;
    //         }
    //         return acc;
    //       }, {} as Record<string, string>);
    //
    //     // Update config object with new settings
    //     Object.entries(envSettings).forEach(([key, value]) => {
    //       // Handle different types of config values
    //       if (key in config) {
    //         const configKey = key as keyof Config;
    //         const configType = ConfigSchema.shape[configKey]._def.typeName;
    //
    //         if (configType.toString() === 'ZodArray') {
    //           (config[configKey] as unknown as string[]) = value.split(' ');
    //         } else if (configType.toString() === 'ZodBoolean') {
    //           (config[configKey] as unknown as boolean) = Boolean(value) || false;
    //         } else if (configType.toString() === 'ZodNumber') {
    //           (config[configKey] as unknown as number) = Number(value) || 0;
    //         } else {
    //           (config[configKey] as unknown as string) = value;
    //         }
    //       }
    //     });
    //
    //     // Update handlers based on new config
    //     if (envSettings.fish_lsp_enabled_handlers) {
    //       updateHandlers(config.fish_lsp_enabled_handlers, true);
    //     }
    //     if (envSettings.fish_lsp_disabled_handlers) {
    //       updateHandlers(config.fish_lsp_disabled_handlers, false);
    //     }
    //
    //     logger.log('Config updated from autoloaded functions');
    //     connection.window.showInformationMessage('Fish LSP configuration updated from autoloaded functions');
    //   } catch (error) {
    //     logger.log(`Error updating config: ${error}`);
    //     connection.window.showErrorMessage(`Error updating config: ${error}`);
    //   }
    // } else {
    //   logger.log('No autoloaded functions found for config update');
    //   connection.window.showInformationMessage('No autoloaded functions found for config update');
    // }
    const { document } = analyzer.analyzePath(path);
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
    const { document } = analyzer.analyzePath(path);
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
    const { document } = analyzer.analyzePath(path);
    if (!document) return;
    const output: string[] = ['\n'];
    const outputCallback = (s: string) => {
      output.push(s);
    };
    generateJsonSchemaShellScript(false, true, true, false, true, outputCallback);
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
    // logger.log('handleShowReferences', uri, position);
    // try {
    // // Use the built-in LSP capability to show references in the editor
    //   // await connection.sendNotification(
    //   //   'textDocument/references',
    //   //   {
    //   //     textDocument: {
    //   //       uri: uri,
    //   //     },
    //   //     position: position,
    //   //     context: {
    //   //       includeDeclaration: true,
    //   //     },
    //   //   }
    //   // );
    //
    // } catch (error) {
    //   logger.error('Error showing references:', error);
    //   connection.sendNotification('window/showMessage', {
    //     type: MessageType.Error,
    //     message: `Error showing references: ${error}`,
    //   });
    // }

    connection.sendNotification('window/showMessage', {
      type: MessageType.Info,  // Info, Warning, Error, Log
      message: ` Fish LSP found ${references.length} references to this symbol `,
    });
    return references;
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
