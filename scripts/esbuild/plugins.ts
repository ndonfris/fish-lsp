// Build plugin factory for consistent configuration
import * as esbuild from 'esbuild';

// ESBuild plugins - these packages don't provide TypeScript definitions

import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';

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

  if (target === 'browser') {
    defines['global'] = 'globalThis';
    defines['navigator'] = '{"language":"en-US"}';
  } else {
    defines['global'] = 'globalThis';
    defines['navigator'] = '{"language":"en-US"}';
  }

  return defines;
}
