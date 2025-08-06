// Build utility functions
import { copySync, ensureDirSync, writeFileSync } from 'fs-extra';
import { existsSync, statSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger, toRelativePath } from './colors';

export function copyBinaryAssets(): void {
  console.log(logger.info('  Skipping asset copying - assets remain in original locations'));
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
    console.log(logger.info(`  ${label}: ${logger.dim(toRelativePath(filePath))}`));
    console.log(logger.size(label, formatBytes(size)));
  }
}

export function generateTypeDeclarations(): void {
  console.log(logger.info('  Generating TypeScript declarations...'));
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
      "outFile": "lib/lsp.d.ts",
      "allowJs": true,
      "moduleResolution": "nodenext",
      "target": "esnext",
      "lib": [
        "esnext", "es2022"
      ]
    },
    "include": [
      "src/**/*.ts",
      "package.json"
    ]
  });
  try {
    writeFileSync('tsconfig.types.json', tsconfigContent);
    execSync('yarn tsc -p tsconfig.types.json', { stdio: 'inherit' });
    console.log(logger.generated('*.d.ts files'));
    unlinkSync('tsconfig.types.json'); // Clean up temporary tsconfig
  } catch (error) {
    logger.warn('Failed to generate type declarations');
  }
}

export async function generateLibraryTypeDeclarations(): Promise<void> {
  console.log(logger.info('📦 Generating library wrapper...'));
  try {
    // Ensure lib directory exists
    ensureDirSync('lib');

    // Generate thin wrapper that imports from dist/fish-lsp with source map reference
    const wrapperContent = `#!/usr/bin/env node

// Thin wrapper that re-exports server functionality from the main binary
// This eliminates code duplication while maintaining the lib/server.js API

const fishLspBinary = require('../dist/fish-lsp');

// Import and export only the server functionality
module.exports = fishLspBinary;

//# sourceMappingURL=../dist/fish-lsp.map
`;

    writeFileSync('lib/server.js', wrapperContent);
    console.log(logger.generated('lib/server.js (thin wrapper)'));

    // Copy only type definitions to lib/ so imports resolve correctly in published package
    console.log(logger.info('  Building type definitions at `lib/lsp.d.ts`'));
    try {
      // Preserve our thin wrapper
      const wrapperBackup = readFileSync('lib/server.js', 'utf8');

      // Copy only .d.ts files while preserving directory structure
      generateTypeDeclarations();

      // Restore our thin wrapper
      writeFileSync('lib/server.js', wrapperBackup);

      console.log(logger.success('✨ Copied type definitions to `lib/lsp.d.ts` (preserved wrapper)'));
    } catch (error) {
      logger.warn('Failed to copy type definitions, falling back to server types only');
      execSync('cp out/server.d.ts lib/server.d.ts', { stdio: 'inherit' });
    }

    console.log(logger.success('✨ Generated library wrapper and types'));
  } catch (error) {
    logger.warn('Failed to generate library wrapper');
  }
}
