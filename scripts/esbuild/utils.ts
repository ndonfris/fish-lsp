// Build utility functions
import { copySync, ensureDirSync, writeFileSync } from 'fs-extra';
import { existsSync, statSync, readFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger, toRelativePath } from './colors';
import { generateEmbeddedAssetsTypesDynamic, cleanupEmbeddedAssetsTypes } from '../generate-embedded-assets-and-types';

export function copyBinaryAssets(): void {
  // Copy fish scripts from src/snippets to dist/snippets
  console.log(logger.info('  Copying fish scripts to dist/snippets...'));
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
    console.log(logger.info(`  ${label}: ${logger.dim(toRelativePath(filePath))}`));
    console.log(logger.size(label, formatBytes(size)));
  }
}

export function generateTypeDeclarations(): void {
  console.log(logger.info(' Generating TypeScript declarations...'));
  
  try {
    execSync('mkdir -p dist');
    
    // Step 1: Generate embedded assets TypeScript modules
    console.log(logger.info('  Generating embedded assets modules...'));
    generateEmbeddedAssetsTypesDynamic();
    
    // Step 2: Create tsconfig with path mapping to embedded assets
    const tsconfigContent = JSON.stringify({
      "extends": ["@tsconfig/node22/tsconfig.json"],
      "compilerOptions": {
        "declaration": true,
        "emitDeclarationOnly": true,
        "outDir": "temp-types",
        // Remove rootDir to avoid conflicts with path mapping
        "target": "es2018",
        "lib": ["es2018", "es2019", "es2020", "es2021", "es2022", "es2023", "dom"],
        "module": "commonjs",
        "moduleResolution": "node",
        "esModuleInterop": true,
        "allowSyntheticDefaultImports": true,
        "strict": false,
        "skipLibCheck": true,
        "skipDefaultLibCheck": true,
        "resolveJsonModule": true,
        "allowJs": false,
        "types": ["node", "vscode-languageserver"],
        // Path mapping to resolve embedded assets
        "baseUrl": ".",
        "paths": {
          "@embedded_assets/*": ["./temp-embedded-assets/*"],
          "@package": ["./temp-embedded-assets/package"]
        },
        // Suppress some strict checks for cleaner output
        "noImplicitAny": false,
        "noImplicitReturns": false,
        "noImplicitThis": false
      },
      "include": [
        "src/**/*.ts"
      ],
      "exclude": [
        "node_modules/**/*",
        "tests/**/*",
        "**/*.test.ts",
        "**/vitest/**/*",
        "node_modules/vitest/**/*"
      ]
    });
    
    writeFileSync('tsconfig.types.json', tsconfigContent);
    
    // Step 2.5: Create debug tsconfig for dts-bundle-generator
    const debugTsconfigContent = JSON.stringify({
      "extends": ["@tsconfig/node22/tsconfig.json"],
      "compilerOptions": {
        "declaration": true,
        "emitDeclarationOnly": true,
        "outDir": "temp-types",
        "target": "es2018",
        "lib": ["es2018", "es2019", "es2020", "es2021", "es2022", "es2023", "dom"],
        "module": "commonjs",
        "moduleResolution": "node",
        "esModuleInterop": true,
        "allowSyntheticDefaultImports": true,
        "strict": false,
        "skipLibCheck": true,
        "skipDefaultLibCheck": true,
        "resolveJsonModule": true,
        "allowJs": false,
        "types": ["node", "vscode-languageserver"],
        "baseUrl": ".",
        "paths": {
          "@embedded_assets/*": ["./temp-embedded-assets/*"],
          "@package": ["./temp-embedded-assets/package"]
        },
        "noImplicitAny": false,
        "noImplicitReturns": false,
        "noImplicitThis": false
      },
      "include": [
        "src/**/*.ts"
      ],
      "exclude": [
        "node_modules/**/*",
        "tests/**/*", 
        "**/*.test.ts",
        "**/vitest/**/*",
        "node_modules/vitest/**/*"
      ]
    });
    
    writeFileSync('tsconfig.debug.json', debugTsconfigContent);
    
    // Step 3: Generate .d.ts files with TypeScript compiler
    console.log(logger.info('  Compiling TypeScript declarations...'));
    execSync('node_modules/typescript/bin/tsc -p tsconfig.types.json', { stdio: 'inherit' });
    
    // Step 4: Bundle all declarations with dts-bundle-generator
    console.log(logger.info('  Bundling type declarations...'));
    
    const dtsConfig = {
      "compilationOptions": {
        "preferredConfigPath": "./tsconfig.debug.json",
        "followSymlinks": false
      },
      "entries": [
        {
          "filePath": "./temp-types/src/main.d.ts",
          "outFile": "./dist/fish-lsp.d.ts",
          "noCheck": true,
          "output": {
            "inlineDeclareExternals": true,
            "sortNodes": true,
            "exportReferencedTypes": false,
            "respectPreserveConstEnum": true,
          },
          "libraries": {
            "allowedTypesLibraries": ["web-tree-sitter", "vscode-languageserver", "vscode-languageserver-textdocument", "node"],
            "importedLibraries": ["web-tree-sitter", "vscode-languageserver", "vscode-languageserver-textdocument"]
          }
        }
      ]
    };
    
    writeFileSync('dts-bundle.config.json', JSON.stringify(dtsConfig, null, 2));
    execSync('yarn dts-bundle-generator --silent --config dts-bundle.config.json --external-inlines=web-tree-sitter --external-types=web-tree-sitter --disable-symlinks-following', { stdio: 'ignore' });
    
    console.log(logger.generated('Successfully generated bundled type declarations'));
    
  } catch (error) {
    console.error(logger.error('Type generation failed:'), error);
    throw error;
  } finally {
    // Clean up temp files and directories
    console.log(logger.info('  Cleaning up temporary files...'));
    try {
      unlinkSync('tsconfig.types.json');
    } catch {}
    try {
      unlinkSync('tsconfig.debug.json');
    } catch {}
    try {
      unlinkSync('dts-bundle.config.json');
    } catch {}
    try {
      execSync('rm -rf temp-types', { stdio: 'pipe' });
    } catch {}
    // Clean up embedded assets
    cleanupEmbeddedAssetsTypes();
  }
}
