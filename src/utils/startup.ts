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
  if (opts.stdio) return 'stdio';
  if (opts.nodeIpc) return 'node-ipc';
  if (opts.socket) return 'socket';
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
 * Easy testing can be done with:
 *   >_ `nodemon --watch src/ --ext ts --exec 'fish-lsp info --time-startup'`
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
    // Create array of workspace analysis promises with timing
    // await Promise.all(workspaces.orderedWorkspaces().map(async (workspace) => {
    //   items[workspace.path] = workspace.paths.length;
    //   all += workspace.paths.length;
    //   await server!.analyzer.analyzeWorkspace(workspace);
    // }));
    const result = await server?.analyzer.initiateBackgroundAnalysis();
    if (result) {
      all = result.totalFilesParsed;
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
    "Indexed Files in '$fish_lsp_all_indexed_paths':".padEnd(65),
    `${all_indexed.length} paths`.padStart(20),
  );
  // const maxItemLen = all_indexed.reduce((max, item) => Math.max(max, item.length > 60 ? 60 : item.length), 0);
  config.fish_lsp_all_indexed_paths.forEach((item, idx) => {
    const text = item.length > 55 ? '...' + item.slice(item.length - 52) : item;
    const output = formatColumns([` [${idx}]`, `| ${text} |`, `${items[item]?.toString() || 0} files`], [6, -59, -10], 85);
    logger.logToStdout(output);
  });
  // incase we decide to log a different starting directory that isn't `~/.config/fish`
  logger.logToStdout('-'.repeat(85));
  // Object.keys(items).forEach((key) => {
  //   const indexedPath = config.fish_lsp_all_indexed_paths.findIndex((item) => item === key);
  //   if (indexedPath !== -1) return;
  //   logger.logToStdoutJoined(
  //     `  ${key}`.padEnd(40),
  //     `${items[key]?.toString()} files`.padStart(66),
  //   );
  // });
}

/**
 * Creates a string with aligned columns for command line output
 * @param text The text for each column
 * @param widths The width for each column (negative for right alignment)
 * @param maxLen The maximum length of the output string
 * @returns A formatted string with aligned columns
 */
function formatColumns(text: string[], widths: number[], maxLen = 85): string {
  const extraSpace: number[] = [].fill(10, text.length - widths.length);
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
