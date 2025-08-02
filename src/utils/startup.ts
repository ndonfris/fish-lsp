import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import FishServer from '../server';
import { createServerLogger, logger } from '../logger';
import { config, configHandlers } from '../config';
import { pathToUri } from './translation';
import { PackageVersion } from './commander-cli-subcommands';
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter, ProposedFeatures } from 'vscode-languageserver/node';
import * as Browser from 'vscode-languageserver/browser';
import { Connection } from 'vscode-languageserver';
import { workspaceManager } from './workspace-manager';
import { Workspace } from './workspace';
import { SyncFileHelper } from './file-operations';

// Define proper types for the connection options
export type ConnectionType = 'stdio' | 'node-ipc' | 'socket';

export interface ConnectionOptions {
  port?: number;
}
export function createConnectionType(opts: {
  stdio?: boolean;
  nodeIpc?: boolean;
  socket?: boolean;
}): ConnectionType {
  if (opts.stdio) return 'stdio';
  if (opts.nodeIpc) return 'node-ipc';
  if (opts.socket) return 'socket';
  return 'stdio';
}

/**
 * Global variable to hold the LSP connection.
 */
export let connection: Connection;

/**
 * Used when the server is started via a shim, like in the vscode extension.
 *
 * Essentially, anywhere that is not using the cli directly to start the server, and
 * is instead using the module directly to connect to the server will need to set the connection
 * manually using this function.
 */
export function setExternalConnection(externalConnection: Connection): void {
  if (!connection) {
    logger.log('Setting external connection for FISH-LSP server');
    connection = externalConnection;
  }
}

/**
 * Creates an LSP connection based on the specified type
 */
function createLspConnection(connectionType: ConnectionType = 'stdio', options: ConnectionOptions = {}) {
  let server: net.Server;
  switch (connectionType) {
    case 'node-ipc':
      connection = createConnection(ProposedFeatures.all);
      break;

    case 'socket':
      if (!options.port) {
        logger.log('Socket connection requires a port number');
        process.exit(1);
      }

      // For socket connections, we need to set up a TCP server
      server = net.createServer((socket) => {
        connection = createConnection(
          new StreamMessageReader(socket),
          new StreamMessageWriter(socket),
        );

        // Server setup code that would normally go in startServer
        setupServerWithConnection(connection);
      });

      server.listen(options.port);
      logger.log(`Server listening on port ${options.port}`);

      // For socket connections, we return null since the connection is created in the callback
      // This is a special case that needs to be handled in startServer
      break;

    case 'stdio':
    default:
      connection = createConnection(
        new StreamMessageReader(process.stdin),
        new StreamMessageWriter(process.stdout),
      );
      break;
  }
}

export type WebServerProps = {
  connection?: Connection;
  params?: InitializeParams;
};

/**
 * Creates a browser connection for the FISH-LSP server.
 */
export function createBrowserConnection(): Connection {
  // const messageReader = new Browser.BrowserMessageReader(self);
  // const messageWriter = new Browser.BrowserMessageWriter(self);
  // const conn = Browser.createConnection(
  //   messageReader,
  //   messageWriter,
  // );
  // let server: FishServer;

  let port = 8080;
  while (isPortTaken(port)) {
    port++;
  }
  connection = Browser.createConnection(
    new Browser.BrowserMessageReader(self),
    new Browser.BrowserMessageWriter(self),
  );

  // const webServer = net.createServer((socket) => {
  //
  //   connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  //     const { initializeResult } = await FishServer.create(connection, params);
  //     Config.isWebServer = true;
  //     return initializeResult;
  //   })
  // });
  //
  // webServer.listen(port);
  // logger.info(`Server listening on port ${port}`);
  return connection;
}

import * as Net from 'net';

/**
 * Checks if a given port is currently in use.
 * @param port The port number to check.
 * @returns A Promise that resolves to `true` if the port is in use, `false` otherwise.
 *          Rejects if an unexpected error occurs during the port check.
 */
function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tester = Net.createServer();

    tester.once('error', (err: any) => {
      // If the error code is 'EADDRINUSE', the port is in use.
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        // Reject for other unexpected errors.
        reject(err);
      }
    });

    tester.once('listening', () => {
      // If we successfully listen, the port is free. Close the server.
      tester.close(() => {
        resolve(false);
      });
    });

    tester.listen(port);
  });
}

// Example usage:

/**
 * Sets up the server with the provided connection
 */
function setupServerWithConnection(connection: Connection): void {
  connection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      const { initializeResult } = await FishServer.create(connection, params);
      return initializeResult;
    },
  );

  // Start listening
  connection.listen();

  // Setup logger
  createServerLogger(config.fish_lsp_log_file, connection.console);
  logger.log('Starting FISH-LSP server');
  logger.log('Server started with the following handlers:', configHandlers);
  logger.log('Server started with the following config:', config);
}

/**
 * Starts the LSP server with the specified connection parameters
 */
export function startServer(connectionType: ConnectionType = 'stdio', options: ConnectionOptions = {}): void {
  // Create connection using the refactored function
  createLspConnection(connectionType, options);

  // For socket connections, the setup is handled in the connection creation
  if (connectionType === 'socket' || !connection) {
    // Connection is already set up in createLspConnection for socket connections
    return;
  }

  // For other connection types, set up the server with the connection
  setupServerWithConnection(connection);
}

export async function timeOperation<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    const end = performance.now();
    const duration = end - start;
    logger.logToStdoutJoined(
      `${label}:`.padEnd(75),
      `${duration.toFixed(2)}ms`.padStart(10),
    );
    return result;
  } catch (error) {
    const end = performance.now();
    const duration = end - start;
    logger.logToStdout(`${label} failed after ${duration.toFixed(2)}ms`);
    throw error;
  }
}

function fixupStartPath(startPath: string | undefined): string | undefined {
  if (!startPath) return undefined;
  if (startPath === '.') {
    return process.cwd();
  }
  const resultPath = SyncFileHelper.expandEnvVars(startPath);
  if (SyncFileHelper.isAbsolutePath(resultPath)) {
    return resultPath;
  }
  return path.resolve(resultPath);
}

type TimeServerOpts = {
  workspacePath?: string;
  showWarning?: boolean;
  timeOnly?: boolean;
};

const defaultTimeServerOpts: Required<TimeServerOpts> = {
  workspacePath: '',
  showWarning: true,
  timeOnly: false,
};

/**
 * Time the startup of the server. Use inside `fish-lsp info --time-startup`.
 * Easy testing can be done with:
 *   >_ `nodemon --watch src/ --ext ts --exec 'fish-lsp info --time-startup'`
 */
export async function timeServerStartup(
  opts: TimeServerOpts = defaultTimeServerOpts,
): Promise<void> {
  // define a local server instance
  let server: FishServer | undefined;

  const startPath = fixupStartPath(opts.workspacePath);

  const title = 'fish-lsp'.padStart(43).padEnd(42);
  if (opts.showWarning && !opts.timeOnly) {
    logger.logToStdoutJoined(
      `${title}\n\n`,
      '       NOTE: a normal server instance will only start one of these workspaces\n\n',
      '       if you frequently find yourself working inside a relatively large \n',
      '       workspaces, please consider using the provided environment variable\n\n',
      '`set -gx fish_lsp_max_background_files`'.padStart(58),
      '\n',
    );
  }

  if (!opts.timeOnly) logger.logToStdout('-'.repeat(85));

  // 1. Time server creation and startup
  await timeOperation(async () => {
    const connection = createConnection(
      new StreamMessageReader(process.stdin),
      new StreamMessageWriter(process.stdout),
    );
    const startUri = path.join(os.homedir(), '.config', 'fish');
    const startupParams: InitializeParams = {
      processId: process.pid,
      rootUri: pathToUri(startUri),
      clientInfo: {
        name: 'fish-lsp info --time-startup',
        version: PackageVersion,
      },
      initializationOptions: {
        fish_lsp_all_indexed_paths: config.fish_lsp_all_indexed_paths,
        fish_lsp_max_background_files: config.fish_lsp_max_background_files,
      },
      workspaceFolders: startPath ? [
        {
          uri: pathToUri(startPath),
          name: 'fish-lsp info --time-startup',
        },
      ] : [],
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
      },
    };
    ({ server } = await FishServer.create(connection, startupParams));
    connection.listen();
    createServerLogger(config.fish_lsp_log_file, connection.console);

    return server;
  }, 'Server Start Time');

  let all: number = 0;
  const items: { [key: string]: number; } = {};

  // clear any existing workspaces, use the env variables if they are set,
  // otherwise use their default values (since there isn't a client)
  workspaceManager.clear();
  const allPaths = startPath ? [startPath] : config.fish_lsp_all_indexed_paths;
  for (const pathLike of allPaths) {
    const fullPath = SyncFileHelper.expandEnvVars(pathLike);
    const workspace = Workspace.syncCreateFromUri(pathToUri(fullPath));
    if (!workspace) {
      logger.logToStderr(`Failed to create workspace for path: ${pathLike}`);
      continue;
    }
    workspaceManager.add(workspace);
  }

  // 2. Time server initialization and background analysis
  await timeOperation(async () => {
    // analyze all documents from the workspaces created above
    const result = await workspaceManager.analyzePendingDocuments();
    if (result) {
      all = result.totalDocuments;
      for (const [path, uris] of Object.entries(result.items)) {
        items[path] = uris.length;
      }
    }
  }, 'Background Analysis Time');

  // 3. Stop here if we only want to log the time
  if (opts.timeOnly) return;

  // 4. Log the number of files indexed
  logger.logToStdoutJoined(
    'Total Files Indexed: '.padEnd(75),
    `${all} files`.padStart(10),
  );

  // 5. Log the directories indexed
  if (!startPath) {
    const all_indexed = config.fish_lsp_all_indexed_paths;
    logger.logToStdoutJoined(
      "Indexed paths in '$fish_lsp_all_indexed_paths':".padEnd(65),
      `${all_indexed.length} paths`.padStart(20),
    );
  } else {
    logger.logToStdoutJoined(
      `Indexed paths in '${startPath.replace(process.cwd(), '.').replace(os.homedir(), '~')}':`.padEnd(65),
      `${Object.keys(items).length} paths`.padStart(20),
    );
  }
  // 6. Log the items indexed
  Object.keys(items).forEach((item, idx) => {
    const text = item.length > 55 ? '...' + item.slice(item.length - 52) : item;
    const output = formatColumns([` [${idx + 1}]`, `| ${text} |`, `${items[item]?.toString() || 0} files`], [6, -59, -10], 85);
    logger.logToStdout(output);
  });
  if (!opts.timeOnly) logger.logToStdout('-'.repeat(85));
}

/**
 * Creates a string with aligned columns for command line output
 * @param text The text for each column
 * @param widths The width for each column (negative for right alignment)
 * @param maxLen The maximum length of the output string
 * @returns A formatted string with aligned columns
 */
function formatColumns(text: string[], widths: number[], maxLen = 85): string {
  const extraSpace: number[] = new Array<number>().fill(10, text.length - widths.length);
  const fixedWidths = widths.length < text.length
    ? [...widths, ...extraSpace]
    : Array.from(widths);
  let maxWidth = 0;
  fixedWidths.map(Math.abs).forEach(num => maxWidth += num);
  let i = 0;
  let remainingWidth = maxLen;
  const result: string[] = [];
  const textLength = text.length - 1;
  const isLast = (i: number) => i === textLength;
  while (text.length > 0) {
    const currentText = text.shift()!;
    const widthItem = fixedWidths.shift()!;
    const width = Math.abs(widthItem);

    const isLastItem = isLast(i);
    const isRightAligned = widthItem < 0 || isLastItem;

    // Truncate if needed
    const content = currentText.length > width
      ? currentText.substring(0, width - 1) + '…'
      : currentText;

    // create the padded content
    let paddedContent = content;
    if (isRightAligned) {
      paddedContent = content.padStart(width) + ' ';
    } else {
      paddedContent = ' ' + content.padEnd(width);
    }
    // fix the last item if it is too short
    remainingWidth -= paddedContent.length;
    if (isLastItem && remainingWidth > 0) {
      paddedContent = ' ' + content.padStart(remainingWidth + width);
    }
    result.push(paddedContent);
    i++;
  }
  return result.join('').trimEnd();
}
