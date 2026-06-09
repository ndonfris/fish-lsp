import { defineConfig, Plugin } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
import tsconfigPaths from 'vite-tsconfig-paths'
import * as path from 'path'
import { readFileSync } from 'fs';

// Plugin to load .fish files as string exports
function fishLoader(): Plugin {
  return {
    name: 'fish-loader',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.fish')) {
        const content = readFileSync(id, 'utf-8')
        return {
          code: `export default ${JSON.stringify(content)};`,
          map: null
        }
      }
    }
  }
}

const isSilent = process.argv.includes('--silent') || process.argv.some(c => c.startsWith('--silent=true'));
const isCI = !!process.env.CI;

const reporters: (string | [string, Record<string, unknown>])[] = isSilent || isCI ? ['verbose'] : ['default'];
if (isCI) reporters.push('github-actions');

export default defineConfig({
  plugins: [, wasm(), fishLoader()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup-mocks.ts'],
    env: isSilent ? { VITEST_SILENT: '1' } : {},
    onConsoleLog: isSilent ? () => false : undefined,
    reporters,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'tests/**',
        'src/**/test/**',
        'src/types/**',
        'src/snippets/**',
        'src/documentation.ts',
        'src/web.ts',
        'src/utils/completions/**',
      ],
      reporter: [
        ['html-spa', { 'projectRoot': './src' }],
        ['lcov', { 'projectRoot': './src' }],
        'text',
      ],
      ignoreEmptyLines: true,
      reportOnFailure: true,
    },
    testTimeout: 25_000,
    fileParallelism: true,
    silent: isSilent,
    hookTimeout: 60_000,
    teardownTimeout: 70_000,
  },
  esbuild: {
    exclude: ['**/*.fish']
  },
  assetsInclude: ['**/*.fish', '**/*.wasm'],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@package': path.resolve(__dirname, 'package.json'),
      '@embedded_assets/tree-sitter.wasm': path.resolve(__dirname, 'tree-sitter.wasm'),
      // '@fish_files/get-docs.fish': (path.resolve(path.join(__dirname, 'fish_files', 'get-docs.fish')))
    }
  }
})
