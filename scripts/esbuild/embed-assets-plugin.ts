import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, extname, join } from 'path';
import type { Plugin } from 'esbuild';

interface EmbedAssetsOptions {
  fishFilesDir?: string;
  wasmFile?: string;
  coreTreeSitterWasmFile?: string;
  manFile?: string;
  packageJson?: string;
}

export function createEmbedAssetsPlugin(options: EmbedAssetsOptions = {}): Plugin {
  return {
    name: 'embed-assets',
    setup(build) {
      const projectRoot = process.cwd();
      
      const defaultOptions = {
        fishFilesDir: resolve(projectRoot, 'fish_files'),
        wasmFile: resolve(projectRoot, 'node_modules/@ndonfris/tree-sitter-fish/tree-sitter-fish.wasm'),
        coreTreeSitterWasmFile: resolve(projectRoot, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
        manFile: resolve(projectRoot, 'man', 'fish-lsp.1'),
        buildTime: resolve(projectRoot, 'out', 'build-time.json'),
        packageJson: resolve(projectRoot, 'package.json'),
        ...options
      };

      // Handle @embedded_assets/ imports
      build.onResolve({ filter: /^@embedded_assets\// }, (args) => {
        const assetPath = args.path.replace('@embedded_assets/', '');
        return {
          path: assetPath,
          namespace: 'embedded-asset'
        };
      });

      // Load embedded assets
      build.onLoad({ filter: /.*/, namespace: 'embedded-asset' }, (args) => {
        const assetPath = args.path;

        // Handle WASM files
        if (assetPath === 'tree-sitter-fish.wasm') {
          if (existsSync(defaultOptions.wasmFile)) {
            const content = readFileSync(defaultOptions.wasmFile);
            const base64 = content.toString('base64');
            return {
              contents: `export default "data:application/wasm;base64,${base64}";`,
              loader: 'js'
            };
          }
          return {
            contents: 'export default "";',
            loader: 'js'
          };
        }

        // Handle core tree-sitter WASM file
        if (assetPath === 'tree-sitter.wasm') {
          if (existsSync(defaultOptions.coreTreeSitterWasmFile)) {
            const content = readFileSync(defaultOptions.coreTreeSitterWasmFile);
            const base64 = content.toString('base64');
            return {
              contents: `export default "data:application/wasm;base64,${base64}";`,
              loader: 'js'
            };
          }
          return {
            contents: 'export default "";',
            loader: 'js'
          };
        }

        // Handle package.json
        if (assetPath === 'package.json') {
          if (existsSync(defaultOptions.packageJson)) {
            const content = readFileSync(defaultOptions.packageJson, 'utf8');
            const json = JSON.parse(content);
            return {
              contents: `export default ${JSON.stringify(json)};`,
              loader: 'js'
            };
          }
          return {
            contents: 'export default {};',
            loader: 'js'
          };
        }

        // Handle man pages
        if (assetPath.startsWith('man/')) {
          const manFilePath = resolve(projectRoot, assetPath);
          if (existsSync(manFilePath)) {
            const content = readFileSync(manFilePath, 'utf8');
            return {
              contents: `export default ${JSON.stringify(content)};`,
              loader: 'js'
            };
          }
          return {
            contents: 'export default "";',
            loader: 'js'
          };
        }

        // Handle fish_files directory
        if (assetPath.startsWith('fish_files/')) {
          const fileName = assetPath.replace('fish_files/', '');
          const fishFilePath = resolve(defaultOptions.fishFilesDir, fileName);
          
          if (existsSync(fishFilePath) && statSync(fishFilePath).isFile()) {
            const content = readFileSync(fishFilePath, 'utf8');
            return {
              contents: `export default ${JSON.stringify(content)};`,
              loader: 'js'
            };
          }
          return {
            contents: 'export default "";',
            loader: 'js'
          };
        }

        // Handle build-time.json
        if (assetPath === 'out/build-time.json') {
          const buildTimePath = resolve(projectRoot, 'out', 'build-time.json');
          if (existsSync(buildTimePath)) {
            const content = readFileSync(buildTimePath, 'utf8');
            const json = JSON.parse(content);
            return {
              contents: `export default ${JSON.stringify(json)};`,
              loader: 'js'
            };
          }
          
          // Create fallback build time
          const now = new Date();
          const fallbackBuildTime = {
            date: now.toDateString(),
            timestamp: now.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }),
            isoTimestamp: now.toISOString(),
            unix: Math.floor(now.getTime() / 1000),
            version: 'unknown',
            nodeVersion: process.version
          };
          return {
            contents: `export default ${JSON.stringify(fallbackBuildTime)};`,
            loader: 'js'
          };
        }

        // Fallback for unknown assets
        return {
          contents: 'export default "";',
          loader: 'js'
        };
      });
    }
  };
}

/**
 * Scans the fish_files directory and returns a list of all .fish files
 */
export function getFishFilesList(fishFilesDir: string): string[] {
  const files: string[] = [];
  
  if (!existsSync(fishFilesDir)) {
    return files;
  }

  function scanDirectory(dir: string, relativePath = ''): void {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      const itemRelativePath = relativePath ? join(relativePath, item) : item;
      
      if (stat.isDirectory()) {
        scanDirectory(fullPath, itemRelativePath);
      } else if (stat.isFile() && extname(item) === '.fish') {
        files.push(itemRelativePath);
      }
    }
  }
  
  scanDirectory(fishFilesDir);
  return files;
}

export default createEmbedAssetsPlugin;
