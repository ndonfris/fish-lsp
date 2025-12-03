// Build utility functions
import fs from 'fs-extra';
import { existsSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { logger, toRelativePath } from './colors';

export function copyDevelopmentAssets(): void {
  if (fs.existsSync('src/snippets')) {
    fs.copySync('src/snippets', 'out/snippets');
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

export function showDirectorySize(dirPath: string, label?: string): void {
  if (!existsSync(dirPath)) {
    return;
  }

  const files = fs.readdirSync(dirPath);
  let totalSize = 0;

  for (const file of files) {
    const filePath = `${dirPath}/${file}`;
    const stats = statSync(filePath);
    
    if (stats.isFile()) {
      totalSize += stats.size;
    }
  }

  const displayLabel = label || dirPath;
  console.log(logger.size(`${displayLabel} total`, formatBytes(totalSize)));
}

export function generateTypeDeclarations(): void {
  console.log(logger.info(' Generating TypeScript declarations...'));
  
  try {
    execSync('mkdir -p dist');

    // Step 1: Create tsconfig used for declaration emit
    const tsconfigContent = JSON.stringify({
      "extends": ["@tsconfig/node22/tsconfig.json"],
      "compilerOptions": {
        "declaration": true,
        "emitDeclarationOnly": true,
        "outDir": "temp-types",
        // Remove rootDir to avoid conflicts with path mapping
        "target": "es2018",
        "lib": ["es2018", "es2019", "es2020", "es2021", "es2022", "es2023", "esnext.iterator", "dom"],
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
        // Suppress some strict checks for cleaner output
        "noImplicitAny": false,
        "noImplicitReturns": false,
        "noImplicitThis": false
      },
      "include": [
        "src/**/*.ts",
        "src/types/embedded-assets.d.ts"
      ],
      "exclude": [
        "node_modules/**/*",
        "tests/**/*",
        "**/*.test.ts",
        "**/vitest/**/*",
        "node_modules/vitest/**/*"
      ]
    });
    
    fs.writeFileSync('tsconfig.types.json', tsconfigContent);
    
    // Step 2.5: Create debug tsconfig for dts-bundle-generator
    const debugTsconfigContent = JSON.stringify({
      "extends": ["@tsconfig/node22/tsconfig.json"],
      "compilerOptions": {
        "declaration": true,
        "emitDeclarationOnly": true,
        "outDir": "temp-types",
        "target": "es2018",
        "lib": ["es2018", "es2019", "es2020", "es2021", "es2022", "es2023", "esnext.iterator", "dom"],
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
        "noImplicitAny": false,
        "noImplicitReturns": false,
        "noImplicitThis": false
      },
      "include": [
        "src/**/*.ts",
        "src/types/embedded-assets.d.ts"
      ],
      "exclude": [
        "node_modules/**/*",
        "tests/**/*", 
        "**/*.test.ts",
        "**/vitest/**/*",
        "node_modules/vitest/**/*"
      ]
    });
    
    fs.writeFileSync('tsconfig.debug.json', debugTsconfigContent);
    
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
    
    fs.writeFileSync('dts-bundle.config.json', JSON.stringify(dtsConfig, null, 2));
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
  }
}
