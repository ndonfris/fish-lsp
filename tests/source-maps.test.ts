import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { build } from 'esbuild';
import { createSourceMapStampPlugin } from '../scripts/esbuild/plugins';
import { checkSourceMapStamp, getSourceMapDownloadURL, getSourceMapInfo, getSourceMappingURL, useRelativeStackTracePaths } from '../src/utils/source-maps';
import PackageJSON from '../package.json';

describe('source map download URL', () => {
  it.each(['1.1.5', '1.1.5-pre.2'])('points at the v%s GitHub release asset', (version) => {
    expect(getSourceMapDownloadURL(version)).toBe(`https://github.com/ndonfris/fish-lsp/releases/download/v${version}/fish-lsp.map`);
  });
});

describe('relative stack trace paths', () => {
  const prepareStackTrace = Error.prepareStackTrace;

  afterEach(() => {
    Error.prepareStackTrace = prepareStackTrace;
  });

  it('rewrites only stack frames under the package root', () => {
    Error.prepareStackTrace = () => 'Error: reading /pkg/src/a.ts\n    at f (/pkg/src/a.ts:1:2)\n    at /pkg/dist/fish-lsp:3:4\n    at /other/b.js:5:6';
    useRelativeStackTracePaths('/pkg');
    expect(new Error().stack).toBe('Error: reading /pkg/src/a.ts\n    at f (./src/a.ts:1:2)\n    at ./dist/fish-lsp:3:4\n    at /other/b.js:5:6');
  });
});

describe('source map detection', () => {
  let directory: string;
  let executable: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fish-lsp-source-maps-'));
    executable = join(directory, 'fish-lsp');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  for (const minify of [false, true]) {
    it.each([false, 'inline', 'linked'] as const)('detects sourcemap=%s in a self-inspecting bundle (minify=' + minify + ')', async (sourcemap) => {
      await build({
        stdin: {
          contents: `
            import { getSourceMapInfo } from './src/utils/source-maps';
            console.log(JSON.stringify({
              marker: '//# sourceMappingURL=',
              info: getSourceMapInfo(process.argv[1]),
            }));
          `,
          resolveDir: resolve('.'),
          loader: 'ts',
        },
        outfile: executable,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify,
        sourcemap,
      });

      const result = JSON.parse(execFileSync(process.execPath, [executable], { encoding: 'utf8' }));
      expect(result.marker).toBe('//# sourceMappingURL=');
      expect(result.info).toEqual(sourcemap === false
        ? { kind: 'none', available: false }
        : {
          kind: sourcemap === 'inline' ? 'inline' : 'external',
          path: sourcemap === 'inline' ? executable : executable + '.map',
          available: true,
        });
    });
  }

  it('does not report a leftover, unreferenced map as available', () => {
    writeFileSync(executable, 'console.log("//# sourceMappingURL=");');
    writeFileSync(executable + '.map', '{}');
    expect(getSourceMapInfo(executable)).toEqual({ kind: 'none', available: false });
  });

  it('reports an external map that has not been downloaded yet', () => {
    writeFileSync(executable, 'console.log(1);\n//# sourceMappingURL=fish-lsp.map\n');
    expect(getSourceMapInfo(executable)).toEqual({ kind: 'external', path: executable + '.map', available: false });
  });

  it('uses the last directive and accepts CRLF and trailing whitespace', () => {
    expect(getSourceMappingURL('//# sourceMappingURL=old.map\r\n  //# sourceMappingURL=new.map \t\r\n')).toBe('new.map');
  });

  it('stamps an external map that only matches its own executable', async () => {
    await build({
      stdin: { contents: 'console.log("stamped");', loader: 'ts' },
      outfile: executable,
      bundle: true,
      platform: 'node',
      sourcemap: 'linked',
      plugins: [createSourceMapStampPlugin()],
    });

    expect(checkSourceMapStamp(executable, executable + '.map')).toMatchObject({ matches: true, version: PackageJSON.version });
    writeFileSync(executable, readFileSync(executable, 'utf8') + '\n// rebuilt');
    expect(checkSourceMapStamp(executable, executable + '.map').matches).toBe(false);
  });
});
