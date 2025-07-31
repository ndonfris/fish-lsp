#!/usr/bin/env node

const esbuild = require('esbuild');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function buildBinary() {
  console.log('Building fish-lsp binary with esbuild...');

  // Ensure build directory exists
  const buildDir = path.join(process.cwd(), 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  try {
    // Read build time for embedding
    const buildTimePath = path.join(process.cwd(), 'out', 'build-time.txt');
    let buildTime = 'unknown';
    try {
      buildTime = fs.readFileSync(buildTimePath, 'utf8').trim();
    } catch (e) {
      console.warn('⚠️  Could not read build-time.txt, using "unknown"');
    }

    // Bundle the CLI with esbuild
    await esbuild.build({
      entryPoints: ['out/cli.js'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: 'build/fish-lsp-bundled.js',
      minify: true,
      treeShaking: true,
      // External modules that should not be bundled
      external: [
        // Keep tree-sitter native modules external since they contain native binaries
        'tree-sitter',
        'web-tree-sitter'
      ],
      // Define NODE_ENV for optimization and embed build time
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.FISH_LSP_BUILD_TIME': `"${buildTime}"`
      },
      // Source maps for debugging if needed
      sourcemap: false,
      // Resolve extensions
      resolveExtensions: ['.js', '.ts', '.json'],
      // Main fields for package resolution
      mainFields: ['main', 'module'],
      // Conditions for package exports
      conditions: ['node', 'import', 'require'],
      // Keep names for better stack traces
      keepNames: true,
      // Loader for specific file types
      loader: {
        '.json': 'json',
        '.wasm': 'file'
      },
      // Copy assets
      assetNames: '[name]',
      // Metafile for analysis
      metafile: true,
      write: true
    });

    // Make the bundled file executable
    const bundledFile = path.join(buildDir, 'fish-lsp-bundled.js');
    execSync(`chmod +x "${bundledFile}"`);

    // Copy required assets
    const assetsToEmbed = [
      'tree-sitter-fish.wasm',
      'fish_files',
      'docs/man/fish-lsp.1',
      'out/build-time.txt'
    ];

    for (const asset of assetsToEmbed) {
      const srcPath = path.join(process.cwd(), asset);
      const destPath = path.join(buildDir, asset);
      
      if (fs.existsSync(srcPath)) {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        if (fs.statSync(srcPath).isDirectory()) {
          execSync(`cp -r "${srcPath}" "${destDir}/"`);
        } else {
          execSync(`cp "${srcPath}" "${destPath}"`);
        }
        console.log(`✅ Copied ${asset}`);
      } else {
        console.warn(`⚠️  Asset not found: ${asset}`);
      }
    }

    console.log('🎉 Build complete!');
    console.log(`📦 Bundled binary: ${bundledFile}`);
    
    // Show bundle size
    const stats = fs.statSync(bundledFile);
    console.log(`📊 Bundle size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildBinary();