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
  resolve: {
    alias: {
      '@package': path.resolve(__dirname, 'package.json'),
      '@embedded_assets/tree-sitter-fish.wasm': path.resolve(__dirname, 'tree-sitter-fish.wasm'),
      '@embedded_assets/tree-sitter.wasm': path.resolve(__dirname, 'tree-sitter.wasm')
    }
  }
})
