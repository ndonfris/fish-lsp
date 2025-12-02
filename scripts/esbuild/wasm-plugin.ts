import { readFileSync } from 'fs';
import path, { resolve } from 'path';
import type { Plugin } from 'esbuild';

/**
 * Loads .wasm files as base64 data URLs so they can be imported directly in bundles.
 */
export function createWasmPlugin(): Plugin {
  return {
    name: 'wasm-loader',
    setup(build) {
      build.onResolve({ filter: /\.wasm$/ }, (args) => {
        const isEmbedded = args.path.startsWith('@embedded_assets/');
        const isRelative = args.path.startsWith('./') || args.path.startsWith('../');
        const isAbsolute = path.isAbsolute(args.path);

        // Let other plugins handle embedded or bare module .wasm specifiers
        if (isEmbedded || (!isRelative && !isAbsolute)) {
          return;
        }
        return {
          path: resolve(args.resolveDir, args.path),
          namespace: 'wasm-inline',
        };
      });

      build.onLoad({ filter: /\.wasm$/, namespace: 'wasm-inline' }, (args) => {
        try {
          const content = readFileSync(args.path);
          const base64 = content.toString('base64');
          return {
            contents: `export default "data:application/wasm;base64,${base64}";`,
            loader: 'js',
          };
        } catch {
          return {
            contents: 'export default "";',
            loader: 'js',
          };
        }
      });
    },
  };
}
