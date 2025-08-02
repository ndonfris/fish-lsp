// Centralized build configurations
import * as esbuild from 'esbuild';
import { resolve } from 'path';
import { createPlugins, createDefines, PluginOptions } from './plugins';
import { copyBinaryAssets } from './utils';

export interface BuildConfig {
  name: string;
  entryPoint: string;
  outfile?: string;
  outdir?: string;
  target: 'node' | 'browser';
  format: 'cjs' | 'esm';
  platform: 'node' | 'browser';
  bundle: boolean;
  minify: boolean;
  sourcemap: boolean;
  external?: string[];
  plugins: PluginOptions;
  onBuildEnd?: () => void;
}

export const buildConfigs: Record<string, BuildConfig> = {
  binary: {
    name: 'Binary',
    entryPoint: 'src/cli.ts',
    outfile: resolve('build', 'fish-lsp'),
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    minify: true,
    sourcemap: false,
    external: ['tree-sitter', 'web-tree-sitter'],
    plugins: {
      target: 'node',
      typescript: true,
      polyfills: 'minimal',
    },
    onBuildEnd: copyBinaryAssets,
  },
  
  web: {
    name: 'Web',
    entryPoint: 'src/web.ts',
    outfile: resolve('build', 'fish-lsp-web.js'),
    target: 'browser',
    format: 'esm',
    platform: 'browser',
    bundle: true,
    minify: true,
    sourcemap: true,
    external: ['web-tree-sitter'],
    plugins: {
      target: 'browser',
      typescript: true,
      polyfills: 'full',
    },
  },

  library: {
    name: 'Library',
    entryPoint: 'src/server.ts',
    outfile: resolve('build', 'server.js'),
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    minify: false, // Keep readable for library use
    sourcemap: true,
    external: ['tree-sitter', 'web-tree-sitter'],
    plugins: {
      target: 'node',
      typescript: true,
      polyfills: 'minimal',
    },
  },

  development: {
    name: 'Development',
    entryPoint: 'src/**/*.ts',
    outdir: 'out',
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: false,
    minify: false,
    sourcemap: true,
    plugins: {
      target: 'node',
      typescript: false, // Use tsc separately
      polyfills: 'none',
    },
  },
};

export function createBuildOptions(config: BuildConfig, production = false): esbuild.BuildOptions {
  return {
    entryPoints: config.bundle ? [config.entryPoint] : [config.entryPoint],
    bundle: config.bundle,
    platform: config.platform,
    target: config.target === 'node' ? 'node18' : 'es2020',
    format: config.format,
    ...(config.outfile ? { outfile: config.outfile } : { outdir: config.outdir }),
    minify: config.minify && production,
    sourcemap: config.sourcemap && !production,
    keepNames: !production,
    treeShaking: config.bundle || production,
    external: config.external,
    define: createDefines(config.target, production),
    plugins: [
      ...createPlugins(config.plugins),
      ...(config.onBuildEnd ? [{
        name: 'build-end-hook',
        setup(build: esbuild.PluginBuild) {
          build.onEnd(config.onBuildEnd!);
        },
      }] : []),
    ],
  };
}