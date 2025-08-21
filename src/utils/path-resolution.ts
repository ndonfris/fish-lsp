import { resolve, dirname } from 'path';
import { realpathSync } from 'fs';
import { SyncFileHelper } from './file-operations';

/**
 * Centralized path resolution utilities for handling bundled vs development environments
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
 * Get the current executable path
 */
export function getCurrentExecutablePath(): string {
  // For bundled binaries, check multiple indicators
  if (process.argv[1]) {
    let execPath = process.argv[1];

    // Resolve symlinks to get the real path
    try {
      execPath = realpathSync(execPath);
    } catch (error) {
      // If realpath fails, use the original path
    }

    // Direct path to bundled binary
    if (execPath.includes('/build/fish-lsp') || execPath.endsWith('/fish-lsp')) {
      return execPath;
    }

    // Check if we're running from a bundled context (no node in argv[0])
    if (!process.argv[0]?.includes('node') && process.argv[1]) {
      return execPath;
    }
  }

  // If this is being run as a Node.js script and argv[1] exists
  if (process.argv[0] && process.argv[0].includes('node') && process.argv[1]) {
    // Return the script that was executed
    return process.argv[1];
  }

  // For library imports, use the current module's directory
  if (!process.argv[1]) {
    // In bundled environment, __filename is undefined, use process.execPath
    return typeof __filename !== 'undefined' ? __filename : process.execPath;
  }

  // Otherwise, return the executable path itself
  return process.execPath;
}

/**
 * Get the correct project root path for both bundled and development versions
 */
export function getProjectRootPath(): string {
  const execPath = getCurrentExecutablePath();

  // For bundled binary in dist directory (NORMAL: bundled development), bin directory (wrapper), or out directory (pre-bundled development (rarely used if ever))
  if (execPath.includes('/dist/') || execPath.includes('/bin/') || execPath.includes('/out/')) {
    // Wrapper script execution from bin/ directory
    if (execPath.includes('/bin/')) {
      return resolve(dirname(execPath), '..');
    }

    // Direct execution from dist/ directory (bundled binary)
    if (execPath.includes('/dist/')) {
      return resolve(dirname(execPath), '..');
    }

    // Direct execution from out/ directory (development)
    if (execPath.includes('/out/')) {
      const pathFromOut = execPath.split('/out/')[1];
      const levels = pathFromOut ? pathFromOut.split('/').length : 1;
      return resolve(dirname(execPath), ...Array(levels).fill('..'));
    }
  }

  // Fallback: use __dirname resolution for development, or process.cwd() for bundled
  return typeof __dirname !== 'undefined' ? resolve(__dirname, '..', '..') : process.cwd();
}

/**
 * Resolves the fish_files directory path for bundled and development versions
 */
export function getFishFilesPath(): string {
  // Try multiple possible locations, prioritizing original location
  const foundPath = findFirstExistingFile(
    // For all versions: relative to project root (original location)
    resolve(getProjectRootPath(), 'fish_files'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'fish_files'),
    // Legacy: for bundled version that copied files alongside the binary
    resolve(dirname(getCurrentExecutablePath()), 'fish_files'),
    // Another fallback: relative to the build directory
    resolve(process.cwd(), 'build/fish_files'),
  );

  // If none found, return the development path and let it fail with a clear error
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
  const foundPath = findFirstExistingFile(
    // For all versions: relative to project root (original location)
    resolve(getProjectRootPath(), 'tree-sitter-fish.wasm'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'tree-sitter-fish.wasm'),
    // Legacy: for bundled version that copied alongside the binary
    resolve(dirname(getCurrentExecutablePath()), 'tree-sitter-fish.wasm'),
    // Another fallback: relative to the build directory
    resolve(process.cwd(), 'build/tree-sitter-fish.wasm'),
  );

  // If none found, return the development path and let it fail with a clear error
  return foundPath ?? resolve(getProjectRootPath(), 'tree-sitter-fish.wasm');
}

/**
 * Get fish build time file path for bundled and development versions
 */
export function getFishBuildTimeFilePath(): string {
  const foundPath = findFirstExistingFile(
    // For bundled version: build-time.txt copied to lib/
    resolve(getProjectRootPath(), 'lib', 'build-time.txt'),
    // For development: out/build-time.txt
    resolve(getProjectRootPath(), 'out', 'build-time.txt'),
    // Fallbacks
    resolve(process.cwd(), 'lib', 'build-time.txt'),
    resolve(process.cwd(), 'out', 'build-time.txt'),
    // Legacy: support old directories
    resolve(getProjectRootPath(), 'build', 'build-time.txt'),
    resolve(getProjectRootPath(), 'dist', 'build-time.txt'),
    resolve(process.cwd(), 'build', 'build-time.txt'),
    resolve(process.cwd(), 'dist', 'build-time.txt'),
    // Legacy: for bundled version that copied scripts/build-time alongside
    resolve(dirname(getCurrentExecutablePath()), 'scripts', 'build-time'),
    resolve(dirname(getCurrentExecutablePath()), 'out', 'build-time.txt'),
    resolve(dirname(getCurrentExecutablePath()), 'dist', 'build-time.txt'),
    resolve(process.cwd(), 'lib/out/build-time.txt'),
    resolve(process.cwd(), 'lib/scripts/build-time'),
    resolve(process.cwd(), 'build/out/build-time.txt'),
    resolve(process.cwd(), 'build/scripts/build-time'),
  );

  return foundPath ?? resolve(getProjectRootPath(), 'out', 'build-time.txt');
}

/**
 * Get man file path for bundled and development versions
 */
export function getManFilePath(): string {
  const foundPath = findFirstExistingFile(
    // For all versions: man directory in project root (new preferred location)
    resolve(getProjectRootPath(), 'man', 'fish-lsp.1'),
    // Legacy: docs/man directory
    resolve(getProjectRootPath(), 'docs', 'man', 'fish-lsp.1'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'man', 'fish-lsp.1'),
    resolve(process.cwd(), 'docs', 'man', 'fish-lsp.1'),
    // Legacy: for bundled version that copied alongside in man structure
    resolve(dirname(getCurrentExecutablePath()), 'man', 'fish-lsp.1'),
    resolve(dirname(getCurrentExecutablePath()), 'docs', 'man', 'fish-lsp.1'),
    // Build directory fallbacks
    resolve(process.cwd(), 'build/man/fish-lsp.1'),
    resolve(process.cwd(), 'build/docs/man/fish-lsp.1'),
  );

  // If none found, return the new preferred path
  return foundPath ?? resolve(getProjectRootPath(), 'man', 'fish-lsp.1');
}

/**
 * Check if we're running in a bundled environment
 */
export function isBundledEnvironment(): boolean {
  const execPath = getCurrentExecutablePath();
  return execPath.includes('/build/');
}
