// Build utility functions
import { copySync, ensureDirSync } from 'fs-extra';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';

export function copyBinaryAssets(): void {
  console.log('Copying binary assets...');

  const assets = [
    { src: 'tree-sitter-fish.wasm', dest: 'build/tree-sitter-fish.wasm' },
    { src: 'fish_files', dest: 'build/fish_files' },
    { src: 'docs/man/fish-lsp.1', dest: 'build/docs/man/fish-lsp.1', createDir: 'build/docs/man' },
    { src: 'out/build-time.txt', dest: 'build/out/build-time.txt', createDir: 'build/out' },
  ];

  for (const asset of assets) {
    if (existsSync(asset.src)) {
      if (asset.createDir) {
        ensureDirSync(asset.createDir);
      }
      copySync(asset.src, asset.dest);
      console.log(`✅ Copied ${asset.src}`);
    } else {
      console.warn(`⚠️  Asset not found: ${asset.src}`);
    }
  }
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