import { resolve, dirname } from 'path';
import { existsSync, realpathSync } from 'fs';

/**
 * Centralized path resolution utilities for handling bundled vs development environments
 */

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
    return __filename;
  }

  // Otherwise, return the executable path itself
  return process.execPath;
}

/**
 * Get the correct project root path for both bundled and development versions
 */
export function getProjectRootPath(): string {
  const execPath = getCurrentExecutablePath();

  // For bundled versions, the executable is in the build directory
  if (execPath.includes('/build/')) {
    // Go up one level from build directory to get project root
    return resolve(dirname(execPath), '..');
  }

  // For development version, go up from out directory
  if (execPath.includes('/out/')) {
    // If we're in a subdirectory of out (like out/utils), go up more levels
    const pathFromOut = execPath.split('/out/')[1];
    // const pathFromOut = execPath.split(/\/\(out\|bin\)\//)[1];
    const levels = pathFromOut ? pathFromOut.split('/').length : 1;
    return resolve(dirname(execPath), ...Array(levels).fill('..'));
  }

  // Fallback: use __dirname resolution for development
  return resolve(__dirname, '..', '..');
}

/**
 * Resolves the fish_files directory path for bundled and development versions
 */
export function getFishFilesPath(): string {
  // Try multiple possible locations for regular builds
  const possiblePaths = [
    // For bundled version: fish_files should be copied alongside the binary
    resolve(dirname(getCurrentExecutablePath()), 'fish_files'),
    // For development version: relative to project root
    resolve(getProjectRootPath(), 'fish_files'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'fish_files'),
    // Another fallback: relative to the build directory
    resolve(process.cwd(), 'build/fish_files'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, return the development path and let it fail with a clear error
  return resolve(getProjectRootPath(), 'fish_files');
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
  const possiblePaths = [
    // For bundled version: should be alongside the binary
    resolve(dirname(getCurrentExecutablePath()), 'tree-sitter-fish.wasm'),
    // For development version: relative to project root
    resolve(getProjectRootPath(), 'tree-sitter-fish.wasm'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'tree-sitter-fish.wasm'),
    // Another fallback: relative to the build directory
    resolve(process.cwd(), 'build/tree-sitter-fish.wasm'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, return the development path and let it fail with a clear error
  return resolve(getProjectRootPath(), 'tree-sitter-fish.wasm');
}

/**
 * Get fish build time file path for bundled and development versions
 */
export function getFishBuildTimeFilePath(): string {
  const possiblePaths = [
    resolve(dirname(getCurrentExecutablePath()), 'out', 'build-time.txt'),
    resolve(getProjectRootPath(), 'out', 'build-time.txt'),
    resolve(process.cwd(), 'out', 'build-time.txt'),
    resolve(process.cwd(), 'build/out/build-time.txt'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return resolve(getProjectRootPath(), 'out', 'build-time.txt');
}

/**
 * Get man file path for bundled and development versions
 */
export function getManFilePath(): string {
  const possiblePaths = [
    // For bundled version: should be copied alongside in docs structure
    resolve(dirname(getCurrentExecutablePath()), 'docs', 'man', 'fish-lsp.1'),
    // For development version: relative to project root
    resolve(getProjectRootPath(), 'docs', 'man', 'fish-lsp.1'),
    // Fallback: relative to process.cwd()
    resolve(process.cwd(), 'docs', 'man', 'fish-lsp.1'),
    // Another fallback: relative to the build directory
    resolve(process.cwd(), 'build/docs/man/fish-lsp.1'),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // If none found, return the development path
  return resolve(getProjectRootPath(), 'docs', 'man', 'fish-lsp.1');
}

/**
 * Check if we're running in a bundled environment
 */
export function isBundledEnvironment(): boolean {
  const execPath = getCurrentExecutablePath();
  return execPath.includes('/build/');
}
