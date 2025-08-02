// Centralized build configurations
import * as esbuild from 'esbuild';
import { resolve } from 'path';
import { createPlugins, createDefines, PluginOptions } from './plugins';
import { copyBinaryAssets } from './utils';

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

export const buildConfigs: Record<string, BuildConfig> = {
  binary: {
    name: 'Binary',
    entryPoint: 'src/cli.ts',
    outfile: resolve('dist', 'fish-lsp'),
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    treeShaking: true,
    minify: false,
    sourcemap: false, // Disabled by default for production; can be enabled with FISH_LSP_SOURCEMAPS=true
    external: ['tree-sitter', 'web-tree-sitter', 'fs', 'path', 'os', 'crypto', 'util'],
    internalPlugins: {
      target: 'node',
      typescript: false, // Use native esbuild TS support
      polyfills: 'none', // Skip polyfills for node target
    },
    onBuildEnd: copyBinaryAssets,
  },
  
  web: {
    name: 'Web',
    entryPoint: 'src/web.ts',
    outfile: resolve('lib', 'fish-lsp-web.js'),
    target: 'browser',
    format: 'esm',
    platform: 'browser',
    bundle: true,
    minify: true,
    sourcemap: true,
    external: ['web-tree-sitter'],
    internalPlugins: {
      target: 'browser',
      typescript: true,
      polyfills: 'full',
    },
  },

  library: {
    name: 'Library',
    entryPoint: 'src/server.ts',
    outfile: resolve('lib', 'server.js'),
    target: 'node',
    format: 'cjs',
    platform: 'node',
    bundle: true,
    minify: false, // Keep readable for library use
    sourcemap: 'external', // Generate external source maps for debugging
    external: ['tree-sitter', 'web-tree-sitter', 'fs', 'path', 'os', 'crypto', 'util'],
    internalPlugins: {
      target: 'node',
      typescript: false, // Use native esbuild TS support
      polyfills: 'none', // Skip polyfills for node target
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
    internalPlugins: {
      target: 'node',
      typescript: false, // Use tsc separately
      polyfills: 'none',
    },
  },
};

export function createBuildOptions(config: BuildConfig, production = false): esbuild.BuildOptions {
  // Source map strategy: 
  // - Development: Always generate external source maps for debugging
  // - Production: Only generate if explicitly enabled via config or environment variable
  const forcedSourceMaps = process.env.FISH_LSP_SOURCEMAPS === 'true';
  const defaultSourceMaps = !production && (config.sourcemap !== false);
  const explicitSourceMaps = config.sourcemap === 'external' || config.sourcemap === true;
  
  const shouldGenerateSourceMaps = forcedSourceMaps || defaultSourceMaps || explicitSourceMaps;
  
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
