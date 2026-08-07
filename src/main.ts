#!/usr/bin/env node

// Enable source map support for better stack traces
import 'source-map-support/register';

// Universal entry point for fish-lsp that handles CLI, Node.js module, and browser usage
// This single file replaces the need for separate entry points and wrappers

// Import polyfills for compatibility
import './utils/polyfills';

// Initialize virtual filesystem first (must be before any fs operations)
import './virtual-fs';

import './utils/commander-cli-subcommands';
import { execCLI } from './cli';
import { isBrowserEnvironment, isNodeRuntime } from './utils/environment';
import type { Connection, InitializeParams } from 'vscode-languageserver';
import FishServerBase from './server';
import {
  registerTerminalAnalysisRequest,
} from './terminal-analysis';

function isRunningAsCLI(): boolean {
  return isNodeRuntime() && !isBrowserEnvironment() && require.main === module;
}

// CLI functionality - only load when needed
async function runCLI() {
  execCLI();
}

// Import web module to ensure it's bundled and can auto-initialize
import './web';

/**
 * Public server wrapper. Keep terminal-only protocol extensions at the package
 * boundary so the core FishServer registration remains focused on standard LSP.
 */
export class FishServer extends FishServerBase {
  public static override async create(
    connection: Connection,
    params: InitializeParams,
  ) {
    const result = await FishServerBase.create(connection, params);
    registerTerminalAnalysisRequest(connection);
    return result;
  }
}

// Export both Node.js and web versions
export { FishLspWeb } from './web';
export { setExternalConnection, createConnectionType } from './utils/startup';
export type { ConnectionType, ConnectionOptions } from './utils/startup';
export {
  TERMINAL_ANALYZE_REQUEST,
  analyzeTerminalBuffer,
  createTerminalDocument,
  registerTerminalAnalysisRequest,
} from './terminal-analysis';
export type {
  TerminalAnalyzeParams,
  TerminalAnalyzeResult,
} from './terminal-analysis';

// Default export for CommonJS compatibility
export default FishServer;

// Auto-initialization based on environment
if (isBrowserEnvironment()) {
  // Browser environments are auto-initialized by web.ts itself
  // No need to do anything here
} else if (isRunningAsCLI() || process.env.NODE_ENV === 'test') {
  // Auto-run CLI if this file is executed directly
  runCLI().catch(async (error) => {
    const { logger } = await import('./logger');
    logger.logToStderr(`Failed to start fish-lsp CLI: ${error}`);
    process.exit(1);
  });
}
