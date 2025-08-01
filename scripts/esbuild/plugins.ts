// Build plugin factory for consistent configuration
import * as esbuild from 'esbuild';

// ESBuild plugins - these packages don't provide TypeScript definitions
// @ts-expect-error - esbuild-plugin-tsc has no types
import esbuildPluginTsc from 'esbuild-plugin-tsc';
// @ts-expect-error - esbuild-plugin-polyfill-node has no types
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
// @ts-expect-error - esbuild-plugins-node-modules-polyfill has no types
import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';
// @ts-expect-error - @esbuild-plugins/node-globals-polyfill has no types
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';

export interface PluginOptions {
  target: 'node' | 'browser';
  typescript: boolean;
  polyfills: 'minimal' | 'full' | 'none';
}

export function createPlugins(options: PluginOptions): esbuild.Plugin[] {
  const plugins: esbuild.Plugin[] = [];

  // TypeScript compilation
  if (options.typescript) {
    plugins.push(
      esbuildPluginTsc({
        tsconfigPath: 'tsconfig.json',
        tsx: false,
        target: 'ES2020',
      })
    );
  }

  // Polyfills based on target and level
  if (options.target === 'browser') {
    if (options.polyfills === 'full') {
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
    }
  } else if (options.target === 'node' && options.polyfills === 'minimal') {
    plugins.push(
      NodeGlobalsPolyfillPlugin({
        buffer: true,
        process: false,
        global: false,
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