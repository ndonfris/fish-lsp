import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { execSync } from 'child_process';
import FishServer from '../server';
import { createServerLogger, logger } from '../logger';
import { config, configHandlers } from '../config';
import { pathToUri, uriToReadablePath } from './translation';
import { PackageVersion } from './commander-cli-subcommands';
import { createConnection, InitializeParams, InitializeResult, StreamMessageReader, StreamMessageWriter, ProposedFeatures } from 'vscode-languageserver/node';
import * as Browser from 'vscode-languageserver/browser';
import { Connection } from 'vscode-languageserver';
import { workspaceManager } from './workspace-manager';
import { SyncFileHelper } from './file-operations';
import { env } from './env-manager';

// Define proper types for the connection options
export type ConnectionType = 'stdio' | 'node-ipc' | 'socket' | 'pipe';

export interface ConnectionOptions {
  port?: number;
}
export function createConnectionType(opts: {
  stdio?: boolean;
  nodeIpc?: boolean;
  pipe?: boolean;
  socket?: boolean;
}): ConnectionType {
  if (opts.stdio) return 'stdio';
  if (opts.nodeIpc) return 'node-ipc';
  if (opts.pipe) return 'pipe';
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

    case 'pipe':
    case 'socket':
      if (!options.port) {
        logger.log('Socket connection requires a port number');
        process.exit(1);
      }

      // For socket connections, we need to set up a TCP server
      server = net.createServer((socket) => {
        connection = createConnection(
          ProposedFeatures.all,
          new StreamMessageReader(socket),
          new StreamMessageWriter(socket),
        );

        // Server setup code that would normally go in startServer
        setupServerWithConnection(connection);
      });

      server.listen(options.port);
      logger.log(`Server listening on port ${options.port}`, server.address());

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
  let port = 8080;
  while (isPortTaken(port)) {
    port++;
  }
  connection = Browser.createConnection(
    new Browser.BrowserMessageReader(globalThis as any),
    new Browser.BrowserMessageWriter(globalThis as any),
  );

  return connection;
}

import * as Net from 'net';
import chalk from 'chalk';

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

  // For pipe and socket connections, the setup is handled in the connection creation
  if (connectionType === 'pipe' || connectionType === 'socket' || !connection) {
    // Connection is already set up in createLspConnection for pipe/socket connections
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
      formatAlignedColumns([
        chalk.blue(`${label}:`.padEnd(75)),
        `${chalk.white.bold(duration.toFixed(2))} ${chalk.white('ms')}`.padStart(10),
      ]),
    );
    return result;
  } catch (error) {
    const end = performance.now();
    const duration = end - start;
    logger.logToStderr(chalk.red(`${label} failed after ${duration.toFixed(2)}ms`));
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
  workspacePath: string;
  warning: boolean;
  timeOnly: boolean;
  showFiles: boolean;
};

const defaultTimeServerOpts: Partial<TimeServerOpts> = {
  workspacePath: '',
  warning: true,
  timeOnly: false,
  showFiles: false,
};

/**
 * Time the startup of the server. Use inside `fish-lsp info --time-startup`.
 * Easy testing can be done with:
 *   >_ `nodemon --watch src/ --ext ts --exec 'fish-lsp info --time-startup'`
 */
export async function timeServerStartup(
  opts: Partial<TimeServerOpts> = defaultTimeServerOpts,
): Promise<void> {
  // define a local server instance
  let server: FishServer | undefined;
  // fix the start path if a relative path is given
  const startPath = fixupStartPath(opts.workspacePath);
  // silence the logger for initial timing operations
  logger.setSilent(true);

  if (opts.warning && !opts.timeOnly) {
    // Title - centered
    logger.logToStdout(formatAlignedColumns([chalk.bold.blue('fish-lsp')]));
    logger.logToStdout('');

    // Warning message with proper centering
    const warningLines = [
      `${chalk.bold.underline.green('NOTE:')} a normal server instance will only start one of these workspaces`,
      '',
      'if you frequently find yourself working inside a relatively large ',
      'workspaces, please consider using the provided environment variable',
      '',
      `\`${chalk.bold.blue('set')} ${chalk.white('-gx')} ${chalk.cyan('fish_lsp_max_background_files')}\``,
    ];

    warningLines.forEach((line) => {
      if (line === '') {
        // Empty line
        logger.logToStdout('');
      } else {
        // Regular warning text - center each line
        logger.logToStdout(formatAlignedColumns([line]));
      }
    });
    logger.logToStdout('');
  }

  if (!opts.timeOnly) stdoutSeparator();

  // 1. Time server creation and startup
  await timeOperation(async () => {
    // Create a null writable stream to discard JSON-RPC messages
    // This prevents them from polluting stdout during timing operations
    const { Writable } = await import('stream');
    const nullStream = new Writable({
      write(chunk, encoding, callback) {
        callback(); // Discard the data
      },
    });

    const connection = createConnection(
      new StreamMessageReader(process.stdin),
      new StreamMessageWriter(nullStream),
    );
    // const startUri = path.join(os.homedir(), '.config', 'fish');
    const startupParams: InitializeParams = {
      processId: process.pid,
      rootUri: path.join(os.homedir(), '.config', 'fish'),
      clientInfo: {
        name: 'fish-lsp info --time-startup',
        version: PackageVersion,
      },
      initializationOptions: {
        // fish_lsp_all_indexed_paths: startPath ? [startPath] : config.fish_lsp_all_indexed_paths,
        fish_lsp_max_background_files: config.fish_lsp_max_background_files,
      },
      workspaceFolders: startPath ? [
        {
          uri: pathToUri(startPath),
          name: 'fish-lsp info --time-startup',
        },
      ] : [
        ...config.fish_lsp_all_indexed_paths.map(p => ({
          uri: pathToUri(SyncFileHelper.expandEnvVars(p)),
          name: p.startsWith('$') ? p.slice(1) : path.basename(SyncFileHelper.expandEnvVars(p)),
        })),
      ],
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
      },
    };
    ({ server } = await FishServer.create(connection, startupParams));
    // Don't call connection.listen() - we're just timing, not handling LSP messages
    // This prevents JSON-RPC output from polluting stdout

    return server;
  }, 'Server Start Time');

  let all: number = 0;
  const items: { [key: string]: string[]; } = {};
  const counts: { [key: string]: number; } = {};

  // 2. Time server initialization and background analysis
  // Call onInitialized() exactly as a real client would - this matches the real server flow 1:1
  await timeOperation(async () => {
    if (!server) {
      throw new Error('Server not initialized');
    }

    // Call onInitialized() which handles background analysis with proper flag management
    const initResult = await server.onInitialized({});
    all = initResult.result;

    // Extract workspace information for display
    const workspaces = workspaceManager.all;
    for (const workspace of workspaces) {
      const uris = Array.from(workspace.allUris);

      // Expand environment variables in workspace paths for display
      // e.g., /$__fish_config_dir → /home/user/.config/fish
      let displayPath = workspace.path;
      if (displayPath.startsWith('/$__fish_config_dir')) {
        displayPath = env.get('__fish_config_dir') || displayPath;
      } else if (displayPath.startsWith('/$__fish_data_dir')) {
        displayPath = env.get('__fish_data_dir') || displayPath;
      }

      // Merge file counts for workspaces with the same expanded path
      // (e.g., __fish_config_dir and $__fish_config_dir both map to /home/user/.config/fish)
      items[displayPath] = (items[displayPath] || 0) + uris.length;

      // Merge file lists for the same workspace
      if (!files[displayPath]) {
        files[displayPath] = [];
      }
      files[displayPath].push(...uris
        .map(u => uriToReadablePath(u))
        .map(p => p.replace(os.homedir(), '~'))
        .map(p => opts.workspacePath ? p.replace(process.cwd().replace(os.homedir(), '~'), '$PWD') : p),
      );
    }
  }, 'Background Analysis Time');

  // 3. Log the number of files indexed
  logger.logToStdoutJoined(
    formatAlignedColumns([
      chalk.blue('Total Files Indexed: '),
      `${chalk.white.bold(all)} ${chalk.white('files')}`,
    ]),
  );

  // 4. Stop here if we only want to log the time
  if (opts.timeOnly) return;

  stdoutSeparator();
  // 5. Log the directories indexed
  if (!startPath) {
    const all_indexed = config.fish_lsp_all_indexed_paths;
    const leftMessage = chalk.blue('Indexed paths in ') + chalk.green('`$fish_lsp_all_indexed_paths`') + chalk.blue(':');

    const amount = all_indexed.length;
    const itemsText = amount === 1 ? 'path' : 'paths';

    const rightMessage = `${chalk.white.bold(amount)} ${chalk.white(itemsText)}`;
    logger.logToStdoutJoined(
      formatAlignedColumns([
        leftMessage,
        rightMessage,
      ]),
    );
  } else {
    const path = startPath.replace(process.cwd(), '.').replace(os.homedir(), '~');
    const leftMessage = chalk.blue('Indexed paths in ') + chalk.green(`\`${path}\``) + chalk.blue(':');
    const amount = Object.keys(items).length;
    const amountText = amount === 1 ? 'path' : 'paths';
    const rightMessage = `${chalk.white.bold(amount)} ${chalk.white(amountText)}`;
    logger.logToStdoutJoined(
      formatAlignedColumns([
        leftMessage,
        rightMessage,
      ]),
    );
  }
  // 6. Log the items indexed
  Object.keys(items).forEach((item, idx) => {
    const text = item.length > 55 ? '...' + item.slice(item.length - 52) : item;
    const filesCount = items[item]?.length || 0;
    const result = formatAlignedColumns([
      {
        text: `${idx + 1}`,
        padLeft: '     [',
        padRight: ']       ',
      },
      {
        text: chalk.green(text),
        padLeft: ' | `',
        padRight: '` | ',
        align: 'left',
        truncate: true,
        truncateIndicator: '…',
        truncateBehavior: 'left',
      },
      chalk.white(`${chalk.white.bold(filesCount)} ${chalk.white(filesCount === 1 ? 'file' : 'files')}`),
    ]);
    logger.logToStdout(result);
  });
  if (!opts.timeOnly) stdoutSeparator();
  if (opts.showFiles) {
    Object.keys(items).forEach((item, idx) => {
      const paths = items[item];
      if (!paths || paths?.length === 0) return;
      if (idx > 0) stdoutSeparator();
      logger.logToStdoutJoined(
        formatAlignedColumns([
          chalk.blue('Files in Folder'),
          chalk.green(`\`${item}\``),
        ]),
      );
      paths.forEach((file, idx) => {
        const text = file.length > 55 ? file.slice(item.length - 55) : file;
        logger.logToStdoutJoined(
          formatAlignedColumns([
            {
              text: chalk.blue(`${idx + 1}`),
              padLeft: '     [',
              padRight: ']       ',
              truncate: true,
              truncateIndicator: ' ',
              truncateBehavior: 'right',
            },
            {
              text: text,
              align: 'right',
              maxWidth: 55,
              truncate: true,
              truncateIndicator: '…',
              truncateBehavior: 'left',
            },
          ]),
        );
      });
    });
  }
}

export type AlignedItem = string | {
  text: string;
  align?: 'left' | 'center' | 'right';

  // Truncation options
  truncate?: boolean;
  truncateIndicator?: string;
  truncateBehavior?: 'left' | 'right' | 'middle';
  maxWidth?: number;

  // Padding options (applied after truncation, before alignment)
  // Note: padLeft/padRight cannot be used with pad
  pad?: string;
  padLeft?: string;
  padRight?: string;

  // Text transformation
  transform?: 'uppercase' | 'lowercase' | 'capitalize';

  // Width constraints
  minWidth?: number;
  fixedWidth?: number;
};

// Helper function to process individual items with all formatting options
function processAlignedItem(item: AlignedItem, availableWidth: number, defaultAlign: 'left' | 'center' | 'right'): { text: string; cleanLength: number; align: 'left' | 'center' | 'right'; } {
  if (typeof item === 'string') {
    return { text: item, cleanLength: item.replace(/\x1b\[[0-9;]*m/g, '').length, align: defaultAlign };
  }

  let processedText = item.text;

  // Apply text transformation
  if (item.transform) {
    const cleanText = processedText.replace(/\x1b\[[0-9;]*m/g, '');
    const ansiMatches = processedText.match(/\x1b\[[0-9;]*m/g) || [];
    let transformedClean = cleanText;

    switch (item.transform) {
      case 'uppercase': transformedClean = cleanText.toUpperCase(); break;
      case 'lowercase': transformedClean = cleanText.toLowerCase(); break;
      case 'capitalize': transformedClean = cleanText.charAt(0).toUpperCase() + cleanText.slice(1).toLowerCase(); break;
    }

    // Reinsert ANSI codes (simplified approach)
    processedText = transformedClean;
    ansiMatches.forEach((ansi, i) => {
      if (i < transformedClean.length) {
        processedText = processedText.slice(0, i) + ansi + processedText.slice(i);
      } else {
        processedText += ansi;
      }
    });
  }

  // Calculate padding lengths
  let padLeftLen = 0;
  let padRightLen = 0;
  let padLeftText = '';
  let padRightText = '';

  if (item.pad) {
    padLeftLen = padRightLen = item.pad.length;
    padLeftText = padRightText = item.pad;
  } else {
    if (item.padLeft) {
      padLeftLen = item.padLeft.length;
      padLeftText = item.padLeft;
    }
    if (item.padRight) {
      padRightLen = item.padRight.length;
      padRightText = item.padRight;
    }
  }

  // Determine alignment direction for truncation
  const align = item.align || defaultAlign;
  const targetWidth = item.maxWidth || availableWidth;

  // Account for padding in target width
  const totalPaddingLength = padLeftLen + padRightLen;
  const availableTextWidth = targetWidth - totalPaddingLength;

  // Handle truncation if needed
  if (item.truncate !== false && availableTextWidth > 0) { // default to true if maxWidth is set
    const cleanText = processedText.replace(/\x1b\[[0-9;]*m/g, '');
    if (cleanText.length > availableTextWidth) {
      const indicator = item.truncateIndicator || '…';
      const indicatorLen = indicator.length;
      const maxContentLength = availableTextWidth - indicatorLen;

      if (maxContentLength <= 0) {
        processedText = indicator;
      } else {
        let truncatedText = '';

        // Determine truncation direction: use explicit truncateBehavior if provided, otherwise use alignment
        const truncationDirection = item.truncateBehavior || (align === 'right' ? 'left' : align === 'center' ? 'middle' : 'right');

        if (truncationDirection === 'left') {
          // Truncate from left (remove from beginning)
          truncatedText = indicator + cleanText.slice(cleanText.length - maxContentLength);
        } else if (truncationDirection === 'middle') {
          // Truncate from both sides (middle)
          const leftPortion = Math.floor(maxContentLength / 2);
          const rightPortion = maxContentLength - leftPortion;
          if (maxContentLength < cleanText.length) {
            truncatedText = cleanText.slice(0, leftPortion) + indicator + cleanText.slice(cleanText.length - rightPortion);
          } else {
            truncatedText = cleanText;
          }
        } else {
          // Truncate from right (remove from end - default)
          truncatedText = cleanText.slice(0, maxContentLength) + indicator;
        }

        processedText = truncatedText;
      }
    }
  }

  // Apply padding after truncation
  const finalText = padLeftText + processedText + padRightText;

  // Handle width constraints
  if (item.fixedWidth) {
    const cleanLength = finalText.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (cleanLength < item.fixedWidth) {
      const padding = item.fixedWidth - cleanLength;
      if (align === 'center') {
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return { text: ' '.repeat(leftPad) + finalText + ' '.repeat(rightPad), cleanLength: item.fixedWidth, align };
      } else if (align === 'right') {
        return { text: ' '.repeat(padding) + finalText, cleanLength: item.fixedWidth, align };
      } else {
        return { text: finalText + ' '.repeat(padding), cleanLength: item.fixedWidth, align };
      }
    }
  }

  if (item.minWidth) {
    const cleanLength = finalText.replace(/\x1b\[[0-9;]*m/g, '').length;
    if (cleanLength < item.minWidth) {
      const padding = item.minWidth - cleanLength;
      if (align === 'center') {
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        return { text: ' '.repeat(leftPad) + finalText + ' '.repeat(rightPad), cleanLength: item.minWidth, align };
      } else if (align === 'right') {
        return { text: ' '.repeat(padding) + finalText, cleanLength: item.minWidth, align };
      } else {
        return { text: finalText + ' '.repeat(padding), cleanLength: item.minWidth, align };
      }
    }
  }

  return {
    text: finalText,
    cleanLength: finalText.replace(/\x1b\[[0-9;]*m/g, '').length,
    align,
  };
}

export function maxWidthForOutput(): number {
  function getColumnsFromEnv(): number | undefined {
    // Try multiple methods to get terminal width

    // 1. Check if COLUMNS is in environment
    if (process.env.COLUMNS) {
      const cols = parseInt(process.env.COLUMNS, 10);
      if (!isNaN(cols) && cols > 0) {
        return cols;
      }
    }

    // 2. Try using process.stdout.columns if available (Node.js TTY)
    if (process.stdout.columns && typeof process.stdout.columns === 'number') {
      return process.stdout.columns;
    }

    // 3. Try executing shell command to get COLUMNS (as fallback)
    try {
      // Try to get COLUMNS from shell environment
      const result = execSync('echo $COLUMNS', {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      const cols = parseInt(result, 10);
      if (!isNaN(cols) && cols > 0) {
        return cols;
      }
    } catch {
      // Ignore errors from shell command
    }

    // 4. Default fallback
    return 95;
  }

  return Math.min(95, getColumnsFromEnv() || 95); // Ensure at least 95 characters wide
}

/**
 * Creates a string with aligned columns based on the number of input strings or explicit alignment
 * @param items The items to align - either strings (with default alignment) or objects with explicit alignment
 * @param maxWidth The maximum width of the output (defaults to process.env.COLUMNS or 95)
 * @returns A formatted string with properly aligned columns
 */
export function formatAlignedColumns(items: AlignedItem[], maxWidth?: number): string {
  const width = maxWidth || maxWidthForOutput();

  if (items.length === 0) return '';

  // Determine default alignment for each position
  const getDefaultAlign = (index: number, total: number): 'left' | 'center' | 'right' => {
    if (total === 1) return 'center';
    if (total === 2) return index === 0 ? 'left' : 'right';
    if (total === 3) return index === 0 ? 'left' : index === 1 ? 'center' : 'right';
    return index === 0 ? 'left' : index === total - 1 ? 'right' : 'center';
  };

  // Process all items with their formatting options
  const processedItems = items.map((item, index) => {
    const defaultAlign = getDefaultAlign(index, items.length);
    return processAlignedItem(item, width, defaultAlign);
  });

  // Calculate total content length
  const totalContentLength = processedItems.reduce((sum, item) => sum + item.cleanLength, 0);
  const availableSpace = Math.max(0, width - totalContentLength);

  if (availableSpace === 0) {
    return processedItems.map(item => item.text).join('');
  }

  // Separate items by alignment
  const leftItems = processedItems.filter(item => item.align === 'left');
  const centerItems = processedItems.filter(item => item.align === 'center');
  const rightItems = processedItems.filter(item => item.align === 'right');

  // Special case: only center items (single item should be centered)
  if (leftItems.length === 0 && rightItems.length === 0 && centerItems.length === 1) {
    const leftPadding = Math.max(0, Math.floor(availableSpace / 2));
    const rightPadding = Math.max(0, availableSpace - leftPadding);
    return ' '.repeat(leftPadding) + centerItems[0]?.text + ' '.repeat(rightPadding);
  }

  // Build the result string
  let result = '';

  // Add left-aligned items
  leftItems.forEach(item => {
    result += item.text;
  });

  // Calculate remaining space after left and right items
  const leftLength = leftItems.reduce((sum, item) => sum + item.cleanLength, 0);
  const rightLength = rightItems.reduce((sum, item) => sum + item.cleanLength, 0);
  const centerLength = centerItems.reduce((sum, item) => sum + item.cleanLength, 0);

  const remainingSpace = width - leftLength - rightLength - centerLength;

  if (centerItems.length === 0) {
    // Only left and right items
    result += ' '.repeat(Math.max(0, remainingSpace));
  } else {
    // Distribute remaining space around center items
    const numGaps = (leftItems.length > 0 ? 1 : 0) + Math.max(0, centerItems.length - 1) + (rightItems.length > 0 ? 1 : 0);
    const gapSize = numGaps > 0 ? Math.max(1, Math.floor(remainingSpace / numGaps)) : Math.floor(remainingSpace / 2);
    const extraSpace = remainingSpace - gapSize * numGaps;

    // Add gap before center items if there are left items
    if (leftItems.length > 0) {
      result += ' '.repeat(gapSize + (extraSpace > 0 ? 1 : 0));
    } else if (centerItems.length > 0 && rightItems.length > 0) {
      result += ' '.repeat(gapSize);
    }

    // Add center items with gaps between them
    centerItems.forEach((item, index) => {
      result += item.text;
      if (index < centerItems.length - 1) {
        result += ' '.repeat(gapSize);
      }
    });

    // Add gap after center items if there are right items
    if (rightItems.length > 0) {
      const usedExtraSpace = leftItems.length > 0 && extraSpace > 0 ? 1 : 0;
      const finalGapSize = gapSize + (extraSpace - usedExtraSpace > 0 ? 1 : 0);
      result += ' '.repeat(Math.max(1, finalGapSize));
    }
  }

  // Add right-aligned items
  rightItems.forEach(item => {
    result += item.text;
  });

  return result;
}

export function stdoutSeparator(): void {
  // Print a separator line to stdout
  logger.logToStdout(formatAlignedColumns([chalk.bold.white('-'.repeat(maxWidthForOutput()))]));
}
