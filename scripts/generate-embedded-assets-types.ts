#!/usr/bin/env tsx

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join, extname } from 'path';
import { execSync } from 'child_process';

/**
 * Generates actual TypeScript modules for embedded assets so that TypeScript
 * compilation and dts-bundle-generator can resolve @embedded_assets/* imports
 */

const projectRoot = process.cwd();
const tempAssetsDir = resolve(projectRoot, 'temp-embedded-assets');

interface AssetPaths {
  fishFilesDir: string;
  wasmFile: string;
  coreTreeSitterWasmFile: string;
  manFile: string;
  buildTimeFile: string;
  packageJson: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function generateWasmModule(filePath: string, outputPath: string): void {
  if (!existsSync(filePath)) {
    // Generate empty module if file doesn't exist
    writeFileSync(outputPath, 'const wasmContent: string = ""; export default wasmContent;');
    return;
  }
  
  const content = readFileSync(filePath);
  const base64 = content.toString('base64');
  const moduleContent = `const wasmContent: string = "data:application/wasm;base64,${base64}";
export default wasmContent;`;
  
  writeFileSync(outputPath, moduleContent);
}

function generateJsonModule(filePath: string, outputPath: string): void {
  if (!existsSync(filePath)) {
    // Generate empty module if file doesn't exist
    writeFileSync(outputPath, 'const data: any = {}; export default data;');
    return;
  }
  
  const content = readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  const moduleContent = `const data = ${JSON.stringify(json, null, 2)};
export default data;${filePath.includes('package.json') ? `
export const name: string = data.name;
export const version: string = data.version;` : ''}`;
  
  writeFileSync(outputPath, moduleContent);
}

function generateTextModule(filePath: string, outputPath: string): void {
  if (!existsSync(filePath)) {
    // Generate empty module if file doesn't exist
    writeFileSync(outputPath, 'const content: string = ""; export default content;');
    return;
  }
  
  const content = readFileSync(filePath, 'utf8');
  const moduleContent = `const content: string = ${JSON.stringify(content)};
export default content;`;
  
  writeFileSync(outputPath, moduleContent);
}

function scanFishFiles(fishFilesDir: string): string[] {
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

export function generateEmbeddedAssetsTypes(): void {
  console.log('Generating embedded assets TypeScript modules...');
  
  // Clean and create temp directory
  if (existsSync(tempAssetsDir)) {
    execSync(`rm -rf "${tempAssetsDir}"`, { stdio: 'pipe' });
  }
  ensureDir(tempAssetsDir);
  
  const assetPaths: AssetPaths = {
    fishFilesDir: resolve(projectRoot, 'fish_files'),
    wasmFile: resolve(projectRoot, 'tree-sitter-fish.wasm'),
    coreTreeSitterWasmFile: resolve(projectRoot, 'tree-sitter.wasm'),
    manFile: resolve(projectRoot, 'man', 'fish-lsp.1'),
    buildTimeFile: resolve(projectRoot, 'out', 'build-time.json'),
    packageJson: resolve(projectRoot, 'package.json'),
  };
  
  // Generate WASM modules
  generateWasmModule(
    assetPaths.wasmFile, 
    resolve(tempAssetsDir, 'tree-sitter-fish.wasm.ts')
  );
  
  generateWasmModule(
    assetPaths.coreTreeSitterWasmFile,
    resolve(tempAssetsDir, 'tree-sitter.wasm.ts')
  );
  
  // Generate JSON modules
  generateJsonModule(
    assetPaths.packageJson,
    resolve(tempAssetsDir, 'package.json.ts')
  );
  
  generateJsonModule(
    assetPaths.buildTimeFile,
    resolve(tempAssetsDir, 'build-time.json.ts')
  );
  
  // Generate man page module
  ensureDir(resolve(tempAssetsDir, 'man'));
  generateTextModule(
    assetPaths.manFile,
    resolve(tempAssetsDir, 'man', 'fish-lsp.1.ts')
  );
  
  // Generate fish files modules
  const fishFiles = scanFishFiles(assetPaths.fishFilesDir);
  const fishFilesDir = resolve(tempAssetsDir, 'fish_files');
  ensureDir(fishFilesDir);
  
  for (const fishFile of fishFiles) {
    const sourcePath = resolve(assetPaths.fishFilesDir, fishFile);
    const outputPath = resolve(fishFilesDir, fishFile + '.ts');
    
    // Ensure nested directories exist
    ensureDir(resolve(outputPath, '..'));
    generateTextModule(sourcePath, outputPath);
  }
  
  // Generate @package module (alias for package.json)
  const packageModuleContent = `import pkg from './package.json';
export default pkg;`;
  writeFileSync(resolve(tempAssetsDir, 'package.ts'), packageModuleContent);
  
  console.log(`Generated embedded assets modules in ${tempAssetsDir}`);
}

export function cleanupEmbeddedAssetsTypes(): void {
  if (existsSync(tempAssetsDir)) {
    execSync(`rm -rf "${tempAssetsDir}"`, { stdio: 'pipe' });
  }
}

// Allow running as script
if (require.main === module) {
  generateEmbeddedAssetsTypes();
}