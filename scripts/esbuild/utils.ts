// Build utility functions
import { copySync, ensureDirSync, writeFileSync } from 'fs-extra';
import { existsSync, statSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger, toRelativePath } from './colors';

export function copyBinaryAssets(): void {
  // Copy fish scripts from src/snippets to dist/snippets
  console.log(logger.info('  Copying fish scripts to dist/snippets...'));
// }
//   // Copy tree-sitter core WASM file from web-tree-sitter dependency
  // const sourceWasm = 'node_modules/web-tree-sitter/tree-sitter.wasm';
  // const destWasm = 'dist/tree-sitter.wasm';
  // 
  // if (existsSync(sourceWasm)) {
  //   try {
  //     ensureDirSync('dist');
  //     copySync(sourceWasm, destWasm);
  //     console.log(logger.copied(sourceWasm, destWasm));
  //   } catch (error) {
  //     logger.warn(`Failed to copy ${sourceWasm} to ${destWasm}: ${error}`);
  //   }
  // } else {
  //   logger.warn(`Source WASM file not found: ${sourceWasm}`);
  // }
  // 
  // console.log(logger.success('✅ Binary assets copied to dist directory'));
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
      "outDir": "temp-types",
      "allowJs": true,
      "moduleResolution": "nodenext",
      "target": "esnext",
      "lib": [
        "esnext", "es2022"
      ],
      "skipLibCheck": true
    },
    "include": [
      "src/server.ts",
      "src/types/*.d.ts"
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
    //
    // const dtsConfig = {
    //   "compilationOptions": {
    //     "preferredConfigPath": "./tsconfig.types.json"
    //   },
    //   "entries": [
    //     {
    //       "filePath": "./src/server.ts",
    //       "outFile": "./dist/fish-lsp.d.ts",
    //       "noCheck": true,
    //       "output": {
    //         "inlineDeclareExternals": false,
    //         "sortNodes": true,
    //         "exportReferencedTypes": false
    //       },
    //       "libraries": {
    //         "allowedTypesLibraries": ["web-tree-sitter"],
    //         "importedLibraries": ["web-tree-sitter", "vscode-languageserver", "vscode-languageserver-textdocument"]
    //       }
    //     }
    //   ]
    // };
    //
    // writeFileSync('dts-bundle.config.json', JSON.stringify(dtsConfig, null, 2));
    // execSync('yarn dts-bundle-generator --config dts-bundle.config.json --external-inlines=web-tree-sitter', { stdio: 'inherit' });

    // unlinkSync('dts-bundle.config.json');

    // Copy the generated server.d.ts to dist
    execSync('cp temp-types/src/server.d.ts dist/fish-lsp.d.ts');
    console.log(logger.generated('Generated type declarations'));
  } catch (error) {
    logger.warn('dts-bundle-generator failed, falling back to simple copy');
    try {
      execSync('cp temp-types/src/server.d.ts dist/fish-lsp.d.ts', { stdio: 'inherit' });
    } catch (copyError) {
      logger.warn('Failed to copy fallback type declarations');
    }
  } finally {
    // Clean up temporary tsconfig
    try {
      unlinkSync('tsconfig.types.json');
    } catch { }
    // Clean up temporary type definitions directory
    try {
      execSync('rm -rf temp-types', { stdio: 'inherit' });
    } catch (cleanupError) {
      logger.warn('Failed to clean up temp-types directory');
    }
  }
}

