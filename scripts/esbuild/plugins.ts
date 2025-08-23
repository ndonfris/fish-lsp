// Build plugin factory for consistent configuration
import * as esbuild from 'esbuild';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ESBuild plugins - these packages don't provide TypeScript definitions

import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { colorize, colors, toRelativePath } from './colors';

export interface PluginOptions {
  target: 'node' | 'browser';
  typescript: boolean;
  polyfills: 'minimal' | 'full' | 'none';
}

export function createPlugins(options: PluginOptions): esbuild.Plugin[] {
  const plugins: esbuild.Plugin[] = [];

  // Note: Using native esbuild TypeScript support instead of external plugin for better performance

  // Polyfills based on target and level - only load when actually needed
  if (options.target === 'browser' && options.polyfills === 'full') {
    plugins.push(
      polyfillNode({
        globals: {
          navigator: false,
          global: true,
          process: true,
        },
        polyfills: {
          fs: true,
          path: true,
          stream: true,
          crypto: true,
          os: true,
          util: true,
          events: true,
          buffer: true,
          process: true,
          child_process: false,
          cluster: false,
          dgram: false,
          dns: false,
          http: false,
          https: false,
          net: false,
          tls: false,
          worker_threads: false,
        },
      }),
      nodeModulesPolyfillPlugin()
    );
  } else if (options.target === 'node' && options.polyfills === 'minimal') {
    plugins.push(
      NodeGlobalsPolyfillPlugin({
        buffer: true,
        process: false,
      })
    );
  }

  return plugins;
}

export function createDefines(target: 'node' | 'browser', production = false): Record<string, string> {
  const defines: Record<string, string> = {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  };

  // Embed build-time for bundled versions
  try {
    const buildTimePath = resolve('out', 'build-time.json');
    const buildTimeData = JSON.parse(readFileSync(buildTimePath, 'utf8'));
    defines['process.env.FISH_LSP_BUILD_TIME'] = `'${JSON.stringify(buildTimeData)}'`;
  } catch (error) {
    // If build-time.json doesn't exist, use current time as fallback
    const now = new Date();
    const timestamp = now.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
    const fallbackBuildTime = {
      date: now.toDateString(),
      timestamp,
      isoTimestamp: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      version: process.env.npm_package_version || 'unknown',
      nodeVersion: process.version
    };
    defines['process.env.FISH_LSP_BUILD_TIME'] = `'${JSON.stringify(fallbackBuildTime)}'`;
  }

  // Embed asset paths for bundled versions (for binary target only)
  if (target === 'node') {
    const projectRoot = resolve(process.cwd());
    defines['process.env.FISH_LSP_BUNDLED'] = '"true"';
    defines['process.env.FISH_LSP_PROJECT_ROOT'] = `"${projectRoot}"`;
    defines['process.env.FISH_LSP_FISH_FILES_PATH'] = `"${resolve(projectRoot, 'fish_files')}"`;
    defines['process.env.FISH_LSP_TREE_SITTER_WASM_PATH'] = `"${resolve(projectRoot, 'tree-sitter-fish.wasm')}"`;
    defines['process.env.FISH_LSP_MAN_FILE_PATH'] = `"${resolve(projectRoot, 'man', 'fish-lsp.1')}"`;
    defines['process.env.FISH_LSP_BUILD_TIME_PATH'] = `"${resolve(projectRoot, 'out', 'build-time.json')}"`;
  }

  if (target === 'browser') {
    defines['global'] = 'globalThis';
    defines['navigator'] = '{"language":"en-US"}';
  } else {
    defines['global'] = 'globalThis';
    defines['navigator'] = '{"language":"en-US"}';
  }

  return defines;
}

/**
 * Plugin to optimize source maps by removing embedded source content
 * This reduces file size significantly while keeping source file references
 * @param preserveSourceContent - Keep source content for debugging (default: false for production, true for development)
 */
export function createSourceMapOptimizationPlugin(preserveSourceContent?: boolean): esbuild.Plugin {
  return {
    name: 'sourcemap-optimization',
    setup(build) {
      build.onEnd((result) => {
        if (!result.outputFiles && build.initialOptions.outfile && build.initialOptions.sourcemap) {
          const outfile = build.initialOptions.outfile;
          const sourcemapFile = outfile + '.map';
          
          try {
            const sourcemapContent = readFileSync(sourcemapFile, 'utf8');
            const originalSize = sourcemapContent.length;
            const sourcemap = JSON.parse(sourcemapContent);
            
            // Remove embedded source content to reduce file size
            // This keeps file references but removes the full source code
            if (preserveSourceContent) {
              console.log(`📦 Source map: ${colorize(toRelativePath(sourcemapFile), colors.white)}`);
              console.log(`  Size: ${colorize((originalSize/1024/1024).toFixed(1) + 'MB', colors.white)} (with source content for debugging)`);
              console.log(`  Sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
            } else if (sourcemap.sourcesContent) {
              delete sourcemap.sourcesContent;
              
              const optimizedContent = JSON.stringify(sourcemap);
              writeFileSync(sourcemapFile, optimizedContent);
              
              const newSize = optimizedContent.length;
              const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(1);
              
              console.log(`📦 Optimized source map: ${colorize(toRelativePath(sourcemapFile), colors.white)}`);
              const reductionSize = colorize(`${reduction}% (${(originalSize/1024/1024).toFixed(1)}MB → ${(newSize/1024/1024).toFixed(1)}MB)`, colors.white);
              console.log(`  Size reduction: ${reductionSize}`);
              console.log(`  Sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
            }
          } catch (error) {
            // Silently ignore if source map doesn't exist or can't be processed
          }
        }
      });
    },
  };
}
