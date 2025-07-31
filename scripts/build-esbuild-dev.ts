#!/usr/bin/env tsx

import * as esbuild from 'esbuild';
import { copySync, ensureDirSync } from 'fs-extra';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
// @ts-ignore
import esbuildPluginTsc from 'esbuild-plugin-tsc';

function copyBinaryAssets(): void {
  console.log('Copying binary assets...');

  // Copy tree-sitter WASM file
  if (existsSync('tree-sitter-fish.wasm')) {
    copySync('tree-sitter-fish.wasm', 'build/tree-sitter-fish.wasm');
    console.log('✅ Copied tree-sitter-fish.wasm');
  }

  // Copy fish_files directory
  if (existsSync('fish_files')) {
    copySync('fish_files', 'build/fish_files');
    console.log('✅ Copied fish_files');
  }

  // Copy docs/man file
  if (existsSync('docs/man/fish-lsp.1')) {
    ensureDirSync('build/docs/man');
    copySync('docs/man/fish-lsp.1', 'build/docs/man/fish-lsp.1');
    console.log('✅ Copied docs/man/fish-lsp.1');
  }

  // Copy build-time file
  if (existsSync('out/build-time.txt')) {
    ensureDirSync('build/out');
    copySync('out/build-time.txt', 'build/out/build-time.txt');
    console.log('✅ Copied out/build-time.txt');
  }
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function buildOptimizedBinary(): Promise<void> {
  console.log('Building with esbuild plugins (TypeScript + Node 20 polyfills)...');

  // Ensure build directory exists
  ensureDirSync('build');

  // Use esbuild plugins for better TypeScript and Node compatibility
  const bundleOptions: esbuild.BuildOptions = {
    entryPoints: ['src/cli.ts'], // Build directly from TypeScript
    bundle: true,
    platform: 'node',
    target: 'node18', // Target Node 18
    format: 'cjs',
    outfile: resolve('build', 'fish-lsp-bundled.js'),
    minify: true,
    treeShaking: true,
    external: ['tree-sitter', 'web-tree-sitter'],
    keepNames: true,
    sourcemap: false,
    plugins: [
      // Use tsc plugin to handle TypeScript compilation with proper targeting
      esbuildPluginTsc({
        tsconfigPath: 'tsconfig.json',
        tsx: false,
        target: 'ES2022', // Use ES2022 to avoid ES2023 features
      }),
    ],
  };

  await esbuild.build(bundleOptions);

  // Generate TypeScript declarations separately
  console.log('Generating TypeScript declarations...');
  execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });

  // Copy snippets to out directory for compatibility
  if (existsSync('src/snippets')) {
    ensureDirSync('out');
    copySync('src/snippets', 'out/snippets');
  }

  // Copy assets and finalize
  copyBinaryAssets();

  const binaryPath = resolve('build', 'fish-lsp-bundled.js');
  if (existsSync(binaryPath)) {
    execSync(`chmod +x "${binaryPath}"`);
    const size = statSync(binaryPath).size;
    console.log('✅ Plugin-based build complete!');
    console.log(`📦 Bundled binary: ${binaryPath}`);
    console.log(`📊 Bundle size: ${formatBytes(size)} (with plugins)`);
  }
}

// Parse command line arguments
const args: string[] = process.argv.slice(2);
const isWatch: boolean = args.includes('--watch') || args.includes('-w');
const isBundle: boolean = args.includes('--bundle') || args.includes('-b');
const isProduction: boolean = args.includes('--production') || args.includes('-p');
const isMinify: boolean = args.includes('--minify') || args.includes('-m');
const isBinary: boolean = args.includes('--binary') || args.includes('--bin');
const isOptimized: boolean = args.includes('--optimized') || args.includes('--opt');

async function build(): Promise<void> {
  try {
    const mode: string = isWatch ? 'watch' : 'build';
    const bundleMode: string = isBundle ? 'bundled' : 'development';
    const binaryMode: string = isBinary ? ' binary' : '';
    const optimizedMode: string = isOptimized ? ' (optimized)' : '';
    console.log(`Building ${bundleMode}${binaryMode}${optimizedMode} version with esbuild (${mode} mode)...`);

    // Handle optimized binary mode (compile first, then bundle for smaller size)
    if (isBinary && isOptimized) {
      return buildOptimizedBinary();
    }

    // Determine output directory and settings based on mode
    const outputDir: string = isBinary ? 'build' : 'out';
    const entryPoints: string[] = isBinary ? ['src/cli.ts'] : ['src/**/*.ts'];
    const shouldBundle: boolean = isBinary || isBundle;

    // Ensure output directory exists
    ensureDirSync(outputDir);

    const buildOptions: esbuild.BuildOptions = {
      entryPoints,
      bundle: shouldBundle,
      platform: 'node',
      target: 'node18', // Use ES2022 for Node 18+ compatibility
      format: 'cjs',
      ...isBinary ? {
        outfile: resolve(outputDir, 'fish-lsp-bundled.js'),
      } : {
        outdir: outputDir,
      },
      sourcemap: !isProduction && !isBinary,
      minify: isMinify || isProduction,
      keepNames: !isProduction,
      logLimit: 250,
      treeShaking: shouldBundle || isProduction,
      ...shouldBundle && {
        external: [
          'tree-sitter',
          'web-tree-sitter',
        ],
      },
      tsconfig: 'tsconfig.json',
      logLevel: 'info',
      plugins: [
        {
          name: 'copy-assets',
          setup(build: esbuild.PluginBuild): void {
            build.onEnd(() => {
              if (isBinary) {
                // Copy binary assets
                copyBinaryAssets();
              } else {
                // Copy development assets
                if (existsSync('src/snippets')) {
                  copySync('src/snippets', `${outputDir}/snippets`);
                }
              }
            });
          },
        },
      ],
    };

    if (isWatch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);

      // Copy initial assets
      if (existsSync('src/snippets')) {
        copySync('src/snippets', 'out/snippets');
        console.log('✅ Copied snippets');
      }

      console.log('  Watching for changes...');
      await ctx.watch();

      // Keep the process running
      process.on('SIGINT', () => {
        console.log('\n   Stopping watch mode...');
        ctx.dispose();
        process.exit(0);
      });
    } else {
      // Single build
      await esbuild.build(buildOptions);

      // Generate TypeScript declarations using tsc (only for non-bundled builds)
      if (!isBundle) {
        console.log('Generating TypeScript declarations...');
        execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });
        console.log('✅ Generated *.d.ts files');
      }

      // Copy JSON files
      if (existsSync('src/snippets')) {
        copySync('src/snippets', 'out/snippets');
        console.log('✅ Copied snippets');
      }

      if (isBinary) {
        // Show binary information
        const binaryPath = resolve('build', 'fish-lsp-bundled.js');
        if (existsSync(binaryPath)) {
          // Make executable
          execSync(`chmod +x "${binaryPath}"`);
          const size = statSync(binaryPath).size;
          console.log('✅ Build complete!');
          console.log(`📦 Bundled binary: ${binaryPath}`);
          console.log(`📊 Bundle size: ${formatBytes(size)}`);
        }
      } else {
        console.log('✅ Build complete!');
      }
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Show usage if --help is passed
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: tsx scripts/build-esbuild-dev.ts [options]

Options:
  --watch, -w         Watch for changes and rebuild
  --bundle, -b        Bundle dependencies (slower but single file)  
  --binary, --bin     Create bundled binary in build/
  --optimized, --opt  Use optimized 2-step build (compile then bundle) for smaller size
  --production, -p    Production build (minified, no sourcemaps)
  --minify, -m        Minify output
  --help, -h          Show this help message

Examples:
  tsx scripts/build-esbuild-dev.ts                       # Development build       (compile)
  tsx scripts/build-esbuild-dev.ts --watch               # Watch mode              (watch)
  tsx scripts/build-esbuild-dev.ts --bundle              # Bundled build           (build single file)
  tsx scripts/build-esbuild-dev.ts --binary              # Create bundled binary   (fast, larger)
  tsx scripts/build-esbuild-dev.ts --binary --optimized  # Create optimized binary (slower, smaller)
  tsx scripts/build-esbuild-dev.ts --production          # Production build
  
  yarn compile                                           # Development build
  yarn watch                                             # Watch mode
`);
  process.exit(0);
}

build();
