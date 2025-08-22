import { resolve, dirname } from 'path';
import { realpathSync } from 'fs';
import { SyncFileHelper } from './file-operations';

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
  // Use environment variable injected at build time if available
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
 */
export function getProjectRootPath(): string {
  // Use embedded project root if available (injected at build time)
  if (process.env.FISH_LSP_PROJECT_ROOT) {
    return process.env.FISH_LSP_PROJECT_ROOT;
  }

  const execPath = getCurrentExecutablePath();

  // For bundled binary in dist directory, bin directory (wrapper), or out directory
  if (execPath.includes('/dist/') || execPath.includes('/bin/') || execPath.includes('/out/')) {
    if (execPath.includes('/bin/') || execPath.includes('/dist/')) {
      return resolve(dirname(execPath), '..');
    }
    if (execPath.includes('/out/')) {
      return resolve(dirname(execPath), '..');
    }
  }

  // Fallback: use __dirname resolution for development, or process.cwd() for bundled
  return typeof __dirname !== 'undefined' ? resolve(__dirname, '..', '..') : process.cwd();
}

/**
 * Resolves the fish_files directory path for bundled and development versions
 */
export function getFishFilesPath(): string {
  // Use embedded path if available (injected at build time)
  if (process.env.FISH_LSP_FISH_FILES_PATH) {
    return process.env.FISH_LSP_FISH_FILES_PATH;
  }

  // Standard locations: project root first, then fallback to cwd
  const foundPath = findFirstExistingFile(
    resolve(getProjectRootPath(), 'fish_files'),
    resolve(process.cwd(), 'fish_files'),
  );

  return foundPath ?? resolve(getProjectRootPath(), 'fish_files');
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
  // Use embedded path if available (injected at build time)
  if (process.env.FISH_LSP_TREE_SITTER_WASM_PATH) {
    return process.env.FISH_LSP_TREE_SITTER_WASM_PATH;
  }

  // Standard locations: project root first, then fallback to cwd
  const foundPath = findFirstExistingFile(
    resolve(getProjectRootPath(), 'tree-sitter-fish.wasm'),
    resolve(process.cwd(), 'tree-sitter-fish.wasm'),
  );

  return foundPath ?? resolve(getProjectRootPath(), 'tree-sitter-fish.wasm');
}

/**
 * Get fish build time file path for bundled and development versions
 */
export function getFishBuildTimeFilePath(): string {
  // Use embedded path if available (injected at build time)
  if (process.env.FISH_LSP_BUILD_TIME_PATH) {
    return process.env.FISH_LSP_BUILD_TIME_PATH;
  }

  // Standard locations: out directory first, then lib directory for bundled
  const foundPath = findFirstExistingFile(
    resolve(getProjectRootPath(), 'out', 'build-time.json'),
    resolve(getProjectRootPath(), 'out', 'build-time.txt'),
    resolve(getProjectRootPath(), 'lib', 'build-time.json'),
    resolve(getProjectRootPath(), 'lib', 'build-time.txt'),
  );

  return foundPath ?? resolve(getProjectRootPath(), 'out', 'build-time.json');
}

/**
 * Get man file path for bundled and development versions
 */
export function getManFilePath(): string {
  // Use embedded path if available (injected at build time)
  if (process.env.FISH_LSP_MAN_FILE_PATH) {
    return process.env.FISH_LSP_MAN_FILE_PATH;
  }

  // Standard locations: man directory in project root
  const foundPath = findFirstExistingFile(
    resolve(getProjectRootPath(), 'man', 'fish-lsp.1'),
    resolve(process.cwd(), 'man', 'fish-lsp.1'),
  );

  return foundPath ?? resolve(getProjectRootPath(), 'man', 'fish-lsp.1');
}
