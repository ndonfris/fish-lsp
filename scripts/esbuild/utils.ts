// Build utility functions
import { copySync, ensureDirSync } from 'fs-extra';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';

export function copyBinaryAssets(): void {
  console.log('Skipping asset copying - assets remain in original locations');
  console.log('✅ Binary assets accessible in original locations');
}

export function copyDevelopmentAssets(): void {
  if (existsSync('src/snippets')) {
    copySync('src/snippets', 'out/snippets');
    console.log('✅ Copied snippets');
  }
}

export function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

export function makeExecutable(filePath: string): void {
  try {
    execSync(`chmod +x "${filePath}"`);
  } catch (error) {
    console.warn(`⚠️  Could not make executable: ${filePath}`);
  }
}

export function showBuildStats(filePath: string, label = 'Bundle'): void {
  if (existsSync(filePath)) {
    const size = statSync(filePath).size;
    console.log(`✅ ${label} complete!`);
    console.log(`📦 ${label}: ${filePath}`);
    console.log(`📊 ${label} size: ${formatBytes(size)}`);
  }
}

export function generateTypeDeclarations(): void {
  console.log('Generating TypeScript declarations...');
  try {
    execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });
    console.log('✅ Generated *.d.ts files');
  } catch (error) {
    console.warn('⚠️  Failed to generate type declarations');
  }
}

export function generateLibraryTypeDeclarations(): void {
  console.log('Generating library type declarations...');
  try {
    // Ensure lib directory exists
    ensureDirSync('lib');
    // Generate bundled type declaration for server.ts using existing out/ files
    execSync('cp out/server.d.ts lib/server.d.ts', { stdio: 'inherit' });
    console.log('✅ Generated bundled library types');
  } catch (error) {
    console.warn('⚠️  Failed to generate library type declarations - ensure "out/" exists');
  }
}
