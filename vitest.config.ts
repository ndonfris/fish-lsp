import { defineConfig, Plugin } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import wasm from 'vite-plugin-wasm'
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

export default defineConfig({
  plugins: [tsconfigPaths(), wasm(), fishLoader()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    setupFiles: ['tests/setup-mocks.ts'],
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
    testTimeout: 20_000,
    fileParallelism: true,
    hookTimeout: 60_000,
    teardownTimeout: 70_000,
  },
  esbuild: {
    exclude: ['**/*.fish']
  },
  assetsInclude: ['**/*.fish', '**/*.wasm'],
  resolve: {
    alias: {
      '@package': path.resolve(__dirname, 'package.json'),
      '@embedded_assets/tree-sitter.wasm': path.resolve(__dirname, 'tree-sitter.wasm'),
      // '@fish_files/get-docs.fish': (path.resolve(path.join(__dirname, 'fish_files', 'get-docs.fish')))
    }
  }
})
