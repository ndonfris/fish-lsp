#!/usr/bin/env node

// Universal entry point for fish-lsp that handles CLI, Node.js module, and browser usage
// This single file replaces the need for separate entry points and wrappers

// Import polyfills for compatibility
import './utils/array-polyfills';

// Initialize virtual filesystem first (must be before any fs operations)
import './virtual-fs';

import './utils/commander-cli-subcommands';
import { execCLI } from './cli';

// Environment detection
function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' || typeof self !== 'undefined';
}

function isRunningAsCLI(): boolean {
  return !isBrowserEnvironment() && require.main === module;
}

// CLI functionality - only load when needed
async function runCLI() {
  execCLI();
}

// Import web module to ensure it's bundled and can auto-initialize
import './web';

// Export both Node.js and web versions
export { default as FishServer } from './server';
export { FishLspWeb } from './web';
export { setExternalConnection, createConnectionType } from './utils/startup';
export type { ConnectionType, ConnectionOptions } from './utils/startup';

// Default export for CommonJS compatibility
import FishServer from './server';
export default FishServer;

// Auto-initialization based on environment
if (isBrowserEnvironment()) {
  // Browser environments are auto-initialized by web.ts itself
  // No need to do anything here
} else if (isRunningAsCLI() || process.env.NODE_ENV === 'test') {
  // Auto-run CLI if this file is executed directly
  runCLI().catch((error) => {
    console.error('Failed to start fish-lsp CLI:', error);
    process.exit(1);
  });
}

