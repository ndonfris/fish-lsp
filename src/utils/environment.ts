// Shared runtime-environment detection, used to distinguish real browser/web
// contexts from Node-compatible CLI runtimes (Node, Bun).

/**
 * Detect whether code is executing in a browser or web-worker context.
 *
 * Uses positive browser-only signals — NOT `typeof self`, since runtimes
 * like Bun define `self` as an alias of `globalThis` for web-API
 * compatibility and would be misidentified as "web", causing the CLI to
 * hang (see https://github.com/ndonfris/fish-lsp/issues/173).
 */
export function isBrowserEnvironment(): boolean {
  return (
    typeof (globalThis as any).window !== 'undefined' ||
    typeof (globalThis as any).document !== 'undefined' ||
    typeof (globalThis as any).importScripts === 'function'
  );
}

/**
 * Detect whether code is executing under a Node-compatible runtime.
 * Bun also sets `process.versions.node`, so this is true under both Node
 * and Bun — exactly the runtimes the CLI must run under.
 */
export function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && !!(process.versions && process.versions.node);
}
