import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Use actual WASM files for tree-sitter functionality in tests
vi.mock('web-tree-sitter/tree-sitter.wasm', () => ({
  default: readFileSync(resolve(__dirname, '../node_modules/web-tree-sitter/tree-sitter.wasm')),
}));

// Legacy mocks for backward compatibility (if needed)
vi.mock('@embedded_assets/tree-sitter-fish.wasm', () => ({
  default: readFileSync(resolve(__dirname, '../node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm')),
}));

vi.mock('@embedded_assets/tree-sitter.wasm', () => ({
  default: readFileSync(resolve(__dirname, '../node_modules/web-tree-sitter/tree-sitter.wasm')),
}));

// Mock other assets
vi.mock('@embedded_assets/man/fish-lsp.1', () => ({
  default: readFileSync(resolve(__dirname, '../man/fish-lsp.1'), 'utf8'),
}));

// Use the actual build-time.json from the out directory
vi.mock('@embedded_assets/build-time.json', () => {
  try {
    return { default: JSON.parse(readFileSync(resolve(__dirname, '../out/build-time.json'), 'utf8')) };
  } catch (error) {
    // Fallback if build-time.json doesn't exist
    return { default: { buildTime: new Date().toISOString(), version: '1.0.0' } };
  }
});

// Mock path resolution functions to prevent incorrect file lookups in test environment
vi.mock('../src/utils/path-resolution', async () => {
  const actual = await vi.importActual('../src/utils/path-resolution') as any;
  return {
    ...actual,
    getFishBuildTimeFilePath: () => resolve(__dirname, '../out/build-time.json'),
    getProjectRootPath: () => resolve(__dirname, '..'),
    getTreeSitterWasmPath: () => resolve(__dirname, '../node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm'),
  };
});

// Mock process-env fish execution to prevent temp file errors in test environment
vi.mock('../src/utils/process-env', async () => {
  const actual = await vi.importActual('../src/utils/process-env') as any;
  return {
    ...actual,
    setupProcessEnvExecFile: vi.fn().mockResolvedValue(undefined),
    getProcessEnvFishPaths: vi.fn().mockResolvedValue({
      __fish_config_dir: '/home/user/.config/fish',
      __fish_data_dir: '/usr/share/fish',
      fish_function_path: '/home/user/.config/fish/functions:/usr/share/fish/functions',
      fish_complete_path: '/home/user/.config/fish/completions:/usr/share/fish/completions',
    }),
  };
});
