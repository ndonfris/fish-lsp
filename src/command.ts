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
  [CommandNames.SHOW_REFERENCES]: [path: string, references: Location[]];  // Add this line
  [CommandNames.SHOW_INFO]: [];
};

// Function to create the command handler with dependencies injected
export function createExecuteCommandHandler(
  connection: Connection,
  docs: LspDocuments,
  analyzer: Analyzer,
) {
  // const codeActionHandler = createCodeActionHandler(docs, analyzer);

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
    // connection.sendNotification('window/showMessage', {
    //   message: message,
    //   type: MessageType.Info,
    // });
    showMessage(message, MessageType.Info);
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
