import { existsSync, readFileSync } from 'fs';
import { dirname, resolve, sep } from 'path';
import { createHash } from 'crypto';

/** Release asset for builds made with `yarn build:external-sourcemaps` (the release tag pins the version). */
export function getSourceMapDownloadURL(version: string) {
  return `https://github.com/ndonfris/fish-lsp/releases/download/v${encodeURIComponent(version)}/fish-lsp.map`;
}

export function getSourceMapHash(bundle: string | Buffer): string {
  return createHash('sha256').update(bundle).digest('hex');
}

/** Read the last standalone source map directive emitted by our builds. */
export function getSourceMappingURL(content: string): string | undefined {
  // Match a whole comment line, so bundled string literals cannot match themselves.
  const directives = content.matchAll(/^[\t ]*\/\/[#@][\t ]*sourceMappingURL=([^\s'"`]+)[\t ]*\r?$/gm);
  let url: string | undefined;
  for (const directive of directives) url = directive[1];
  return url;
}

export type SourceMapInfo =
  | { kind: 'none'; available: false; }
  | { kind: 'inline'; path: string; available: true; }
  | { kind: 'external'; path: string; available: boolean; };

export function getSourceMapInfo(executablePath: string): SourceMapInfo {
  const url = getSourceMappingURL(readFileSync(executablePath, 'utf8'));
  if (!url) return { kind: 'none', available: false };
  if (url.startsWith('data:')) {
    return { kind: 'inline', path: executablePath, available: true };
  }
  const mapPath = resolve(dirname(executablePath), url);
  return { kind: 'external', path: mapPath, available: existsSync(mapPath) };
}

/**
 * Print stack frames relative to the package root (`./src/server.ts:1278:11`),
 * rather than wherever fish-lsp is installed. Wraps the formatter installed by
 * `source-map-support/register`, so it must run after that import.
 */
export function useRelativeStackTracePaths(root: string) {
  const prepareStackTrace = Error.prepareStackTrace;
  if (!prepareStackTrace) return;
  const prefix = root.endsWith(sep) ? root : root + sep;
  Error.prepareStackTrace = (error, stack) => {
    const trace = prepareStackTrace(error, stack);
    if (typeof trace !== 'string') return trace;
    return trace.split('\n')
      .map(line => line.startsWith('    at ') ? line.split(prefix).join('./') : line)
      .join('\n');
  };
}

/** Build metadata stamped into external maps by the `sourcemap-stamp` esbuild plugin. */
export type SourceMapStamp = {
  matches: boolean;
  version?: string;
  commit?: string;
};

/** Check that an external map was generated for the exact executable bytes beside it. */
export function checkSourceMapStamp(executablePath: string, mapPath: string): SourceMapStamp {
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    return {
      matches: map.x_fish_lsp_sha256 === getSourceMapHash(readFileSync(executablePath)),
      version: map.x_fish_lsp_version,
      commit: map.x_fish_lsp_commit,
    };
  } catch {
    return { matches: false };
  }
}
