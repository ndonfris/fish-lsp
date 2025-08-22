// Build utility functions
import { copySync, ensureDirSync, writeFileSync } from 'fs-extra';
import { existsSync, statSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger, toRelativePath } from './colors';

export function copyBinaryAssets(): void {
  console.log(logger.info('  Skipping asset copying - assets remain in original locations'));
  console.log(logger.success('✅ Binary assets accessible in original locations'));
}

export function copyDevelopmentAssets(): void {
  if (existsSync('src/snippets')) {
    copySync('src/snippets', 'out/snippets');
    console.log(logger.copied('src/snippets', 'out/snippets'));
  }
}

export function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

export function makeExecutable(filePath: string): void {
  try {
    execSync(`chmod +x "${filePath}"`);
    console.log(logger.executable(filePath));
  } catch (error) {
    logger.warn(`Could not make executable: ${filePath}`);
  }
}

export function showBuildStats(filePath: string, label = 'Bundle'): void {
  if (existsSync(filePath)) {
    const size = statSync(filePath).size;
    console.log(logger.complete(label));
    console.log(logger.info(`  ${label}: ${logger.dim(toRelativePath(filePath))}`));
    console.log(logger.size(label, formatBytes(size)));
  }
}

export function generateTypeDeclarations(): void {
  console.log(logger.info('  Generating TypeScript declarations...'));
  const tsconfigContent = JSON.stringify({
    "extends": ["@tsconfig/node22/tsconfig.json", "@tsconfig/node-ts/tsconfig.json"],
    "compilerOptions": {
      "declaration": true,
      "emitDeclarationOnly": true,
      "erasableSyntaxOnly": false,
      "verbatimModuleSyntax": false,
      "resolveJsonModule": true,
      "allowSyntheticDefaultImports": true,
      "allowArbitraryExtensions": true,
      "esModuleInterop": true,
      "outDir": "lib",
      "allowJs": true,
      "moduleResolution": "nodenext",
      "target": "esnext",
      "lib": [
        "esnext", "es2022"
      ],
      "types": ["node"],
      "skipLibCheck": true
    },
    "include": [
      "src/server.ts"
    ],
    "exclude": [
      "node_modules/**/*",
      "tests/**/*",
      "**/*.test.ts",
      "node_modules/vitest/**/*",
      "**/*vitest*"
    ]
  });
  try {
    writeFileSync('tsconfig.types.json', tsconfigContent);
    execSync('node_modules/typescript/bin/tsc -p tsconfig.types.json', { stdio: 'inherit' });
    
    // Now use dts-bundle-generator to bundle all declarations into a single file
    console.log(logger.info('  Using dts-bundle-generator to create clean types...'));
    
    // Create a config file to avoid vitest conflicts
    const dtsConfig = {
      "compilationOptions": {
        "preferredConfigPath": "./tsconfig.types.json"
      },
      "entries": [
        {
          "filePath": "./src/server.ts",
          "outFile": "./lib/server.d.ts",
          "noCheck": true,
          "output": {
            "inlineDeclareExternals": false,
            "sortNodes": true,
            "exportReferencedTypes": false
          },
          "libraries": {
            "allowedTypesLibraries": ["web-tree-sitter"],
            "importedLibraries": ["web-tree-sitter", "vscode-languageserver", "vscode-languageserver-textdocument"]
          }
        }
      ]
    };
    
    writeFileSync('dts-bundle.config.json', JSON.stringify(dtsConfig, null, 2));
    execSync('yarn dts-bundle-generator --config dts-bundle.config.json --external-inlines=web-tree-sitter', { stdio: 'inherit' });
    
    // Clean up config file
    try {
      unlinkSync('dts-bundle.config.json');
    } catch {}
    console.log(logger.generated('Bundled type declarations'));
  } catch (error) {
    logger.warn('dts-bundle-generator failed, falling back to simple copy');
    try {
      execSync('cp out/server.d.ts lib/server.d.ts', { stdio: 'inherit' });
    } catch (copyError) {
      logger.warn('Failed to copy fallback type declarations');
    }
  } finally {
    unlinkSync('tsconfig.types.json'); // Clean up temporary tsconfig
  }
}

export async function generateLibraryTypeDeclarations(): Promise<void> {
  console.log(logger.info('📦 Generating type definitions for universal binary...'));
  try {
    // Ensure dist directory exists
    ensureDirSync('dist');

    // Generate type definitions directly in dist/ directory for the universal binary
    console.log(logger.info('  Building type definitions at `dist/fish-lsp.d.ts`'));
    
    try {
      // Copy existing server types as the base (since main.ts exports FishServer)
      execSync('cp out/server.d.ts dist/fish-lsp.d.ts', { stdio: 'inherit' });
      console.log(logger.generated('Universal binary type definitions'));
    } catch (copyError) {
      logger.warn('Failed to copy type declarations');
    }

    console.log(logger.success('✨ Generated universal binary type definitions'));
  } catch (error) {
    logger.warn('Failed to generate type definitions');
  }
}