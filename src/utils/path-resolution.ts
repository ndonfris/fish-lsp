import { resolve, dirname } from 'path';
import { realpathSync } from 'fs';
import { SyncFileHelper } from './file-operations';
import { vfs } from '../virtual-fs';

/**
 * Centralized path resolution utilities for handling bundled vs development environments
 * Uses embedded paths from build-time when available, with clean fallbacks to standard locations
 */

/**
 * Finds the first existing file from an array of possible file paths
 * @param possiblePaths File paths to check
 * @returns The first path that exists as a file, or undefined if none exist
 */
export function findFirstExistingFile(...possiblePaths: string[]): string | undefined {
  for (const path of possiblePaths) {
    if (SyncFileHelper.exists(path) && SyncFileHelper.isFile(path)) {
      return path;
    }
  }
  return undefined;
}

/**
 * Helper function to check if a path exists and is a file
 * @param path The path to check
 * @returns True if the path exists and is a file
 */
export function isExistingFile(path: string): boolean {
  return SyncFileHelper.exists(path) && SyncFileHelper.isFile(path);
}

/**
 * Check if we're running in a bundled environment
 */
export function isBundledEnvironment(): boolean {
  // Use environment variable injected at build time, or check if we don't have __dirname
  return !!process.env.FISH_LSP_BUNDLED || typeof __dirname === 'undefined';
}

/**
 * Get the current executable path
 */
export function getCurrentExecutablePath(): string {
  if (process.argv[1]) {
    try {
      return realpathSync(process.argv[1]);
    } catch {
      return process.argv[1];
    }
  }

  // For library imports, use the current module's directory or process executable
  return typeof __filename !== 'undefined' ? __filename : process.execPath;
}

/**
 * Get the correct project root path for both bundled and development versions
 * Dynamically resolves from current working directory instead of hardcoded paths
 */
export function getProjectRootPath(): string {
  // For bundled mode, always use current working directory (where binary is executed)
  if (isBundledEnvironment()) {
    return process.cwd();
  }

  // For development mode, try to detect project root from executable location
  const execPath = getCurrentExecutablePath();

  // For development binary in dist directory, bin directory (wrapper), or out directory
  if (execPath.includes('/dist/') || execPath.includes('/bin/') || execPath.includes('/out/')) {
    if (execPath.includes('/bin/') || execPath.includes('/dist/')) {
      return resolve(dirname(execPath), '..');
    }
    if (execPath.includes('/out/')) {
      return resolve(dirname(execPath), '..');
    }
  }

  // Fallback: use __dirname resolution for development
  return typeof __dirname !== 'undefined' ? resolve(__dirname, '..', '..') : process.cwd();
}

/**
 * Resolves the fish_files directory path for bundled and development versions
 */
export function getFishFilesPath(): string {
  return vfs.getPathOrFallback(
    'fish_files',
    resolve(getProjectRootPath(), 'fish_files'),
    resolve(process.cwd(), 'fish_files'),
  );
}

/**
 * Resolves a specific fish file path
 */
export function getFishFilePath(filename: string): string {
  return resolve(getFishFilesPath(), filename);
}

/**
 * Get tree-sitter WASM file path for bundled and development versions
 */
export function getTreeSitterWasmPath(): string {
  return vfs.getPathOrFallback(
    'tree-sitter-fish.wasm',
    resolve(getProjectRootPath(), 'tree-sitter-fish.wasm'),
    resolve(process.cwd(), 'tree-sitter-fish.wasm'),
  );
}

export function getCoreTreeSitterWasmPath(): string {
  return vfs.getPathOrFallback(
    'tree-sitter.wasm',
    resolve(getProjectRootPath(), 'tree-sitter.wasm'),
    resolve(process.cwd(), 'tree-sitter.wasm'),
  );
}

/**
 * Get fish build time file path for bundled and development versions, note that
 * this a generated build-time.json file should be used if available, otherwise
 * fallback to standard bundled location
 */
export function getFishBuildTimeFilePath(): string {
  const localBuildTimePath = resolve(getProjectRootPath(), 'build-time.json');
  if (localBuildTimePath && isExistingFile(localBuildTimePath)) {
    return localBuildTimePath;
  }
  return vfs.getPathOrFallback(
    'out/build-time.json',
    resolve(getProjectRootPath(), 'out', 'build-time.json'),
  );
}

/**
 * Get man file path for bundled and development versions
 */
export function getManFilePath(): string {
  return vfs.getPathOrFallback(
    'man/fish-lsp.1',
    resolve(getProjectRootPath(), 'man', 'fish-lsp.1'),
    resolve(process.cwd(), 'man', 'fish-lsp.1'),
  );
}

/**
 * Get embedded fish scripts interface
 */
export function getEmbeddedFishScripts() {
  return vfs.fishFiles || null;
}
