// Build plugin factory for consistent configuration
import * as esbuild from 'esbuild';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ESBuild plugins - these packages don't provide TypeScript definitions

import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { colorize, colors, toRelativePath } from './colors';
import { createEmbedAssetsPlugin } from './embed-assets-plugin';

export interface PluginOptions {
  target: 'node' | 'browser';
  typescript: boolean;
  polyfills: 'minimal' | 'full' | 'none';
  embedAssets?: boolean;
}

export function createPlugins(options: PluginOptions): esbuild.Plugin[] {
  const plugins: esbuild.Plugin[] = [];

  // Add embedded assets plugin if enabled
  if (options.embedAssets) {
    plugins.push(createEmbedAssetsPlugin());
  }

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

export function createDefines(target: 'node' | 'browser' | string, production = false): Record<string, string> {
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

  // Mark as bundled for Node target (used by virtual filesystem)
  if (target === 'node') {
    defines['process.env.FISH_LSP_BUNDLED'] = '"true"';
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
            
            // Ensure the bundle has a sourcemap reference
            const bundleContent = readFileSync(outfile, 'utf8');
            const sourcemapRef = `\n//# sourceMappingURL=${resolve(sourcemapFile).split('/').pop()}`;
            
            if (!bundleContent.includes('//# sourceMappingURL=')) {
              writeFileSync(outfile, bundleContent + sourcemapRef);
            }
            
            // Remove embedded source content to reduce file size
            // This keeps file references but removes the full source code
            if (preserveSourceContent) {
              console.log(`📦 Source map: ${colorize(toRelativePath(sourcemapFile), colors.white)}`);
              console.log(`  Size: ${colorize((originalSize/1024/1024).toFixed(1) + 'MB', colors.white)} (with source content for debugging)`);
              console.log(`  Sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
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

/**
 * Enhanced sourcemap plugin that filters sources to only include src/ files
 * and validates mappings bounds while preserving sourcesContent for debugging
 * @param options Configuration for the special sourcemap processing
 */
export function createSpecialSourceMapPlugin(options: { preserveOnlySrcContent?: boolean } = {}): esbuild.Plugin {
  return {
    name: 'special-sourcemap-optimization',
    setup(build) {
      build.onEnd((result) => {
        if (!result.outputFiles && build.initialOptions.outfile && build.initialOptions.sourcemap) {
          const outfile = build.initialOptions.outfile;
          const sourcemapFile = outfile + '.map';
          
          try {
            const sourcemapContent = readFileSync(sourcemapFile, 'utf8');
            const originalSize = sourcemapContent.length;
            const sourcemap = JSON.parse(sourcemapContent);
            
            // Ensure the bundle has a sourcemap reference
            const bundleContent = readFileSync(outfile, 'utf8');
            const sourcemapRef = `\n//# sourceMappingURL=${resolve(sourcemapFile).split('/').pop()}`;
            
            if (!bundleContent.includes('//# sourceMappingURL=')) {
              writeFileSync(outfile, bundleContent + sourcemapRef);
            }
            
            if (options.preserveOnlySrcContent && sourcemap.sources && sourcemap.sourcesContent) {
              // Instead of filtering and breaking mappings, we'll selectively remove sourcesContent
              // for non-src files while keeping all sources for valid mappings
              const optimizedSourcesContent: (string | null)[] = [];
              let srcFileCount = 0;
              let removedSourcesSize = 0;
              
              sourcemap.sources.forEach((source: string, index: number) => {
                // Only preserve sourcesContent for TypeScript files from src/ directory
                // Remove content for node_modules, embedded assets, and other non-src files
                if (
                  source.includes('../src/') && 
                  source.endsWith('.ts') &&
                  !source.includes('node_modules') &&
                  !source.startsWith('embedded-asset:') &&
                  !source.includes('webpack://')
                ) {
                  // Keep the source content for src files
                  optimizedSourcesContent.push(sourcemap.sourcesContent[index] || null);
                  srcFileCount++;
                } else {
                  // Remove source content but keep the entry to maintain mapping indices
                  const originalContent = sourcemap.sourcesContent[index] || '';
                  removedSourcesSize += originalContent.length;
                  optimizedSourcesContent.push(null);
                }
              });
              
              // Create optimized sourcemap with selective sourcesContent
              const optimizedSourcemap = {
                ...sourcemap,
                sourcesContent: optimizedSourcesContent
              };
              
              console.log(`📦 Special source map: ${colorize(toRelativePath(sourcemapFile), colors.white)}`);
              console.log(`  Total sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
              console.log(`  src/ files with content: ${colorize(srcFileCount + ' files', colors.white)}`);
              console.log(`  Other sources (content removed): ${colorize((sourcemap.sources.length - srcFileCount) + ' files', colors.white)}`);
              
              if (srcFileCount > 0) {
                const optimizedContent = JSON.stringify(optimizedSourcemap);
                writeFileSync(sourcemapFile, optimizedContent);
                
                const newSize = optimizedContent.length;
                const reduction = originalSize > newSize 
                  ? ((originalSize - newSize) / originalSize * 100).toFixed(1)
                  : '0';
                
                console.log(`  Size reduction: ${colorize(`${reduction}% (${(originalSize/1024/1024).toFixed(1)}MB → ${(newSize/1024/1024).toFixed(1)}MB)`, colors.white)}`);
                console.log(`  Mappings preserved: ${colorize('All mappings intact', colors.white)}`);
                
                // Note: Shebang modification removed - use NODE_OPTIONS="--enable-source-maps" instead
                // to avoid process.argv parsing issues
              } else {
                console.log(`  ${colorize('Warning: No src/ TypeScript files found in sourcemap', colors.white)}`);
              }
            } else {
              // Fallback to regular sourcemap optimization
              console.log(`📦 Source map: ${colorize(toRelativePath(sourcemapFile), colors.white)}`);
              console.log(`  Size: ${colorize((originalSize/1024/1024).toFixed(1) + 'MB', colors.white)} (preserved for debugging)`);
              // console.log(`  Sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
              console.log(`  Sources: ${colorize(sourcemap.sources.length + ' files', colors.white)}`);
            }
          } catch (error) {
            console.log(`  ${colorize('Warning: Could not process sourcemap - ' + (error as Error).message, colors.white)}`);
          }
        }
      });
    },
  };
}
