// Centralized build configurations
import * as esbuild from 'esbuild';
import { resolve } from 'path';
import { createPlugins, createDefines, PluginOptions } from './plugins';
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
    sourcemap: true, // Generate external source maps for debugging
    external: ['tree-sitter', 'web-tree-sitter', 'fs', 'path', 'os', 'crypto', 'util'],
    internalPlugins: {
      target: 'node',
      typescript: false, // Use native esbuild TS support
      polyfills: 'minimal', // Include minimal polyfills for browser compatibility when needed
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

export function createBuildOptions(config: BuildConfig, production = false): esbuild.BuildOptions {
  // Always generate compact external sourcemaps for binary builds
  // This creates small .map files that reference original TypeScript sources
  const shouldGenerateSourceMaps = config.sourcemap !== false;
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
    sourcesContent: false, // Don't embed source content - reference files instead
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
      ...(config.onBuildEnd ? [{
        name: 'build-end-hook',
        setup(build: esbuild.PluginBuild) {
          build.onEnd(config.onBuildEnd!);
        },
      }] : []),
    ],
  };
}
