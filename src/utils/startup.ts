// import { Connection, createConnection, InitializeParams, InitializeResult, IPCMessageReader, IPCMessageWriter, ProposedFeatures, SocketMessageReader, SocketMessageWriter, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node';
import FishServer from '../server';
import { createServerLogger, logger } from '../logger';
import { config, configHandlers } from '../config';
import * as path from 'path';
import * as os from 'os';
import { pathToUri } from './translation';
import { PackageVersion } from './commander-cli-subcommands';

import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter, ProposedFeatures, Connection } from 'vscode-languageserver/node';
import * as net from 'net';

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
  if (opts.stdio) {
    return 'stdio';
  }
  if (opts.nodeIpc) {
    return 'node-ipc';
  }
  if (opts.socket) {
    return 'socket';
  }
  return 'stdio';
}

export let connection: Connection;

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
/**
 * Creaete a connection for the server. Initialize the server with the connection.
 * Listen for incoming messages and handle them.
 */
// export function startServer() {
//   // Create a connection for the server.
//   // The connection uses stdin/stdout for communication.
//   const connection = createConnection(
//     new StreamMessageReader(process.stdin),
//     new StreamMessageWriter(process.stdout),
//   );
//   connection.onInitialize(
//     async (params: InitializeParams): Promise<InitializeResult> => {
//       const { initializeResult } = await FishServer.create(connection, params);
//       return initializeResult;
//     },
//   );
//   connection.listen();
//   createServerLogger(config.fish_lsp_log_file, connection.console);
//   logger.log('Starting FISH-LSP server');
//   logger.log('Server started with the following handlers:', configHandlers);
//   logger.log('Server started with the following config:', config);
// }

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

/**
 * Time the startup of the server. Use inside `fish-lsp info --time-startup`.
 */
export async function timeServerStartup() {
  // define a local server instance
  let server: FishServer | undefined;

  const title = 'fish-lsp'.padStart(43).padEnd(42);
  logger.logToStdoutJoined(
    `${title}\n\n`,
    '       NOTE: a normal server instance will only start one of these workspaces\n\n',
    '       if you frequently find yourself working inside a relatively large \n',
    '       workspaces, please consider using the provided environment variable\n\n',
    '`set -gx fish_lsp_max_background_files`'.padStart(58),
    '\n',
  );
  logger.logToStdout('-'.repeat(85));

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
      initializationOptions: {},
      workspaceFolders: [],
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
  let items: { [key: string]: number; } = {};

  // 2. Time server initialization and background analysis
  await timeOperation(async () => {
    const result = await server?.initializeBackgroundAnalysisForTiming();
    if (result) {
      all = result.all;
      items = result.items;
    }
  }, 'Background Analysis Time');

  // 3. Log the number of files indexed
  logger.logToStdoutJoined(
    'Total Files Indexed: '.padEnd(75),
    `${all} files`.padStart(10),
  );

  // 4. Log the directories indexed
  const all_indexed = config.fish_lsp_all_indexed_paths;
  logger.logToStdoutJoined(
    "Indexed Files in '$fish_lsp_all_indexed_paths':".padEnd(75),
    `${all_indexed.length} paths`.padStart(10),
  );
  const maxItemLen = all_indexed.reduce((max, item) => Math.max(max, item.length), 0);
  const startStr = ' '.repeat(3);
  config.fish_lsp_all_indexed_paths.forEach((item, idx) => {
    logger.logToStdoutJoined(
      `${startStr}$fish_lsp_all_indexed_paths[${idx + 1}]  `.padEnd(64 - maxItemLen),
      `|${item}|`.padStart(maxItemLen + 6).padEnd(65 - (maxItemLen + 4)),
      `${items[item]!.toString()} files`.padStart(14),
    );
  });
  // incase we decide to log a different starting directory that isn't `~/.config/fish`
  logger.logToStdout('-'.repeat(85));
  Object.keys(items).forEach((key) => {
    const indexedPath = config.fish_lsp_all_indexed_paths.findIndex((item) => item === key);
    if (indexedPath !== -1) return;
    logger.logToStdoutJoined(
      `  ${key}`.padEnd(40),
      `${items[key]!.toString()} files`.padStart(66),
    );
  });
}
