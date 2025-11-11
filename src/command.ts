import { Connection, ExecuteCommandParams, MessageType, /** Position, */ Range, Location, TextEdit, WorkspaceEdit, /** ProgressToken,*/ Position } from 'vscode-languageserver';
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
import { pathToUri, uriToPath, uriToReadablePath } from './utils/translation';
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
  // Formats: [path, line, character] or [path, "line,character"] or [symbolName]
  [CommandNames.SHOW_REFERENCES]: string[];
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

  type ParsedShowReferencesArgs =
    | { type: 'symbol'; name: string; }
    | { type: 'location'; path: string; line: string; char: string; }
    | { type: 'invalid'; reason: string; };

  function parseShowReferencesArgs(args: string[]): ParsedShowReferencesArgs {
    switch (args.length) {
      case 1: {
        const [arg] = args;
        if (!arg) {
          return { type: 'invalid', reason: 'Missing argument' };
        }
        // Check if this looks like a path (contains /, ~, or $ENV_VAR)
        // OR if it can be expanded to a different value (meaning it has expandable components)
        const isPathLike = arg.includes('/') || arg.startsWith('~') || arg.includes('$');
        const canExpand = SyncFileHelper.isExpandable(arg);

        if (isPathLike || canExpand) {
          return { type: 'invalid', reason: 'Path provided without line/character position' };
        }
        return { type: 'symbol', name: arg };
      }
      case 2: {
        const [pathArg, posArg] = args;
        if (!pathArg || !posArg) {
          return { type: 'invalid', reason: 'Missing path or position argument' };
        }
        const coords = posArg.split(',');
        if (coords.length !== 2) {
          return { type: 'invalid', reason: 'Position must be in format: <line>,<character>' };
        }
        const [lineStr, charStr] = coords;
        if (!lineStr || !charStr) {
          return { type: 'invalid', reason: 'Both line and character must be provided' };
        }
        return { type: 'location', path: pathArg, line: lineStr, char: charStr };
      }
      case 3: {
        const [pathArg, lineStr, charStr] = args;
        if (!pathArg || !lineStr || !charStr) {
          return { type: 'invalid', reason: 'Missing path, line, or character argument' };
        }
        return { type: 'location', path: pathArg, line: lineStr, char: charStr };
      }
      default:
        return { type: 'invalid', reason: args.length === 0 ? 'No arguments provided' : 'Too many arguments' };
    }
  }

  async function showReferences(...args: string[]) {
    logger.log('showReferences called with args:', args);

    const parsed = parseShowReferencesArgs(args);

    if (parsed.type === 'invalid') {
      logger.warning('Invalid showReferences arguments:', { args, reason: parsed.reason });
      showMessage(
        `Invalid arguments: ${parsed.reason}\n\n` +
        'Usage:\n' +
        '  fish-lsp.showReferences <symbolName>\n' +
        '  fish-lsp.showReferences <path> <line>,<character>\n' +
        '  fish-lsp.showReferences <path> <line> <character>\n\n' +
        'Examples:\n' +
        '  fish-lsp.showReferences my_function\n' +
        '  fish-lsp.showReferences ~/.config/fish/config.fish 7,10\n' +
        '  fish-lsp.showReferences $XDG_CONFIG_HOME/fish/config.fish 7 10\n' +
        '  fish-lsp.showReferences /absolute/path/to/file.fish 7 10',
        MessageType.Error,
      );
      return [];
    }

    let uri: string;
    let position: Position;

    if (parsed.type === 'symbol') {
      logger.log('Searching for global symbol:', parsed.name);

      const globalSymbol = analyzer.globalSymbols.findFirst(parsed.name);

      if (!globalSymbol) {
        showMessage(`No global symbol found with name: ${parsed.name}`, MessageType.Error);
        return [];
      }

      logger.log('Found global symbol:', {
        name: globalSymbol.name,
        uri: globalSymbol.uri,
        range: globalSymbol.range,
      });

      uri = globalSymbol.uri;
      position = globalSymbol.toPosition();
    } else if (parsed.type === 'location') {
      // Use SyncFileHelper to properly expand path (handles ~, $ENV_VARS, etc.)
      const expandedPath = SyncFileHelper.expandEnvVars(parsed.path);

      const line = parseInt(parsed.line, 10);
      const character = parseInt(parsed.char, 10);

      if (isNaN(line) || isNaN(character)) {
        showMessage('Invalid line or character number', MessageType.Error);
        return [];
      }

      // Convert 1-indexed (user-facing) line numbers to 0-indexed (LSP) positions
      // Users see line 7 in their editor, but LSP uses 0-indexed positions (line 6)
      uri = pathToUri(expandedPath);
      position = Position.create(line - 1, character);
    } else {
      // TypeScript exhaustiveness check - this should never happen
      // const _exhaustive: never = parsed;
      return [];
    }

    logger.log('showReferences', { uri, position });

    // Call server.onReferences() directly to get references
    const references = await FishServer.instance.onReferences({
      textDocument: { uri },
      position: position,
      context: {
        includeDeclaration: true,
      },
    });

    logger.log('showReferences result', {
      count: references.length,
      references: references.map(loc => ({
        uri: loc.uri,
        range: loc.range,
      })),
    });

    if (references.length === 0) {
      showMessage(
        `No references found at ${uriToReadablePath(uri)}:${position.line + 1}:${position.character + 1}`,
        MessageType.Info,
      );
      return references;
    } else {
      // Format references as a readable message
      const refMessage = references.map((loc, idx) => {
        const locPath = uriToReadablePath(loc.uri);
        const line = loc.range.start.line + 1;
        const char = loc.range.start.character + 1;
        return `  [${idx + 1}] ${locPath}:${line}:${char}`;
      }).join('\n');

      const message = `Found ${references.length} reference(s):\n${refMessage}`;
      showMessage(message, MessageType.Info);
    }

    // Group references by URI to find the first reference in each document
    const referencesByUri = new Map<string, Location[]>();
    for (const ref of references) {
      const existing = referencesByUri.get(ref.uri) || [];
      existing.push(ref);
      referencesByUri.set(ref.uri, existing);
    }

    // Navigate to the first reference in each document
    for (const [refUri, refs] of referencesByUri.entries()) {
      // Ensure document is un-opened
      if (docs.isOpen(uriToPath(refUri)) || uri === refUri) {
        logger.log(`Document already open, skipping: ${uriToReadablePath(refUri)}`);
        continue;
      }

      // Verify the document exists before trying to open it
      const refPath = uriToPath(refUri);
      const refDoc = docs.get(refPath) || analyzer.analyzePath(refPath)?.document;

      if (!refDoc) {
        logger.warning(`Skipping non-existent document: ${uriToReadablePath(refUri)}`);
        continue;
      }

      // Sort references by line number to get the first one in the document
      const sortedRefs = refs.sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) {
          return a.range.start.line - b.range.start.line;
        }
        return a.range.start.character - b.range.start.character;
      });

      const firstRef = sortedRefs[0];
      if (!firstRef) continue;

      if (workspaceManager.current?.getUris().includes(refUri) === false) {
        logger.log(`Reference URI not in current workspace, skipping: ${uriToReadablePath(refUri)}`);
        continue;
      }

      // Use window/showDocument to open and navigate to the first reference
      try {
        await connection.sendRequest('window/showDocument', {
          uri: refUri,
          takeFocus: false, // Don't steal focus from current document
          selection: firstRef?.range, // Highlight the first reference
        });
        logger.log(`Opened ${uriToReadablePath(refUri)} at line ${firstRef!.range.start.line + 1}`);
      } catch (error) {
        logger.error(`Failed to show document ${refUri}:`, error);
      }
    }

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
  const commandHandlers: Record<string, (...args: any[]) => Promise<void> | void | Promise<Location[]> | Promise<Location[] | undefined>> = {
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
