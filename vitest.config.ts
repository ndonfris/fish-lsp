import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import wasm from 'vite-plugin-wasm'
import path from 'path'

export default defineConfig({
  plugins: [tsconfigPaths(), wasm()],
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
        'src/**/test/**'
      ]
    }
  },
  esbuild: {
    exclude: ['**/*.fish']
  },
  resolve: {
    alias: {
      '@package': path.resolve(__dirname, 'package.json'),
      '@embedded_assets/tree-sitter-fish.wasm': path.resolve(__dirname, 'tree-sitter-fish.wasm'),
      '@embedded_assets/tree-sitter.wasm': path.resolve(__dirname, 'tree-sitter.wasm'),
      // Alias fish files to prevent tsx compilation
      '@embedded_assets/fish_files/exec.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/expand_cartesian.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-autoloaded-filepath.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-command-options.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-completion.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-dependency.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-documentation.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-fish-autoloaded-paths.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-type-verbose.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js'),
      '@embedded_assets/fish_files/get-type.fish': path.resolve(__dirname, 'tests/mocks/fish-files.js')
    }
  }
})
