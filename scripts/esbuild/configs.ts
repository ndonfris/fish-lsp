// Centralized build configurations
import * as esbuild from 'esbuild';
import { resolve } from 'path';
import { createPlugins, createDefines, PluginOptions, createSourceMapOptimizationPlugin } from './plugins';
import { copyBinaryAssets } from './utils';
import { BuildConfigTarget } from "./types";

export interface BuildConfig extends esbuild.BuildOptions {
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
  plugins?: esbuild.Plugin[];
  internalPlugins?: PluginOptions;
  onBuildEnd?: () => void;
}

export const buildConfigs: Record<BuildConfigTarget, BuildConfig> = {
  binary: {
    name: 'Universal Binary',
    entryPoint: 'src/main.ts',
    outfile: resolve('dist', 'fish-lsp'),
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    treeShaking: true,
    minify: false,
    assetNames: 'assets/[name]-[hash]', // Include hash in asset names for cache busting
    loader: {
      '.wasm': 'file',
      '.node': 'file',

    },
    sourcemap: true, // Generate external source maps for debugging
    preserveSymlinks: true,
    // external: ['web-tree-sitter', 'fs', 'path', 'os', 'crypto', 'util'],
    // external: ['tree-sitter', 'web-tree-sitter', 'fs', 'path', 'os', 'crypto', 'util'],
    external: [],
    internalPlugins: {
      target: 'node',
      typescript: false, // Use native esbuild TS support
      polyfills: 'minimal', // Include minimal polyfills for browser compatibility when needed
      embedAssets: true, // Enable embedded assets for binary builds
    },
    onBuildEnd: copyBinaryAssets,
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
    internalPlugins: {
      target: 'node',
      typescript: false, // Use tsc separately
      polyfills: 'none',
    },
  },
};

export function createBuildOptions(config: BuildConfig, production = false, sourcemapsMode: 'optimized' | 'extended' | 'none' = 'optimized'): esbuild.BuildOptions {
  // Configure sourcemaps based on mode
  const shouldGenerateSourceMaps = config.sourcemap !== false && sourcemapsMode !== 'none';
  const sourcemapSetting = shouldGenerateSourceMaps ? 'external' : false;

  return {
    entryPoints: config.bundle ? [config.entryPoint] : [config.entryPoint],
    bundle: config.bundle,
    platform: config.platform,
    target: config.target === 'node' ? 'node18' : 'es2020',
    format: config.format,
    ...(config.outfile ? { outfile: config.outfile } : { outdir: config.outdir }),
    minify: config.minify && production,
    sourcemap: sourcemapSetting,
    sourcesContent: true, // Will be optimized by plugin based on environment
    keepNames: !production,
    treeShaking: config.bundle ? true : production,
    external: config.external,
    define: createDefines(config.target, production),
    // Performance optimizations for startup speed
    splitting: false, // Disable code splitting for faster startup
    metafile: false, // Disable metadata generation
    legalComments: 'none', // Remove legal comments for smaller bundles
    ignoreAnnotations: false, // Keep function annotations for V8 optimization
    // mangleProps: false, // Don't mangle properties to avoid runtime overhead
    plugins: [
      ...createPlugins(config.internalPlugins),
      createSourceMapOptimizationPlugin(sourcemapsMode === 'extended'), // Preserve source content for extended mode
      ...(config.onBuildEnd ? [{
        name: 'build-end-hook',
        setup(build: esbuild.PluginBuild) {
          build.onEnd(config.onBuildEnd!);
        },
      }] : []),
    ],
  };
}
