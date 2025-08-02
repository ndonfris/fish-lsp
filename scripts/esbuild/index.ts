#!/usr/bin/env tsx

import * as esbuild from 'esbuild';

// Re-export utilities
export * from './plugins';
export * from './configs';
export * from './utils';
export * from './cli';

// Import everything we need for the main build function
import { parseArgs, showHelp } from './cli';
import { buildConfigs, createBuildOptions } from './configs';
import { generateTypeDeclarations, generateLibraryTypeDeclarations, copyDevelopmentAssets, showBuildStats, makeExecutable } from './utils';

/**
 * Main build function - can be called programmatically or from CLI
 */
export async function build(customArgs?: string[]): Promise<void> {
  const args = parseArgs();
  
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  try {
    if (args.target === 'all') {
      const targets: Array<keyof typeof buildConfigs> = ['development', 'library', 'binary', 'web'];
      
      if (args.watch) {
        // Watch mode for all targets
        console.log('🚀 Starting watch mode for all targets...');
        const contexts: esbuild.BuildContext[] = [];
        
        for (const targetName of targets) {
          const config = buildConfigs[targetName];
          const buildOptions = createBuildOptions(config, args.production || args.minify);
          
          console.log(`\n📦 Starting watch for ${config.name.toLowerCase()}...`);
          const ctx = await esbuild.context(buildOptions);
          contexts.push(ctx);
          
          // Post-build tasks for initial build
          if (targetName === 'development') {
            generateTypeDeclarations();
            copyDevelopmentAssets();
          } else if (targetName === 'library' && config.outfile) {
            generateLibraryTypeDeclarations();
          } else if (targetName === 'binary' && config.outfile) {
            makeExecutable(config.outfile);
          }
          
          await ctx.watch();
        }
        
        console.log('\n👀 Watching all targets for changes...');
        
        // Keep the process running and handle cleanup
        process.on('SIGINT', () => {
          console.log('\n🛑 Stopping watch mode...');
          Promise.all(contexts.map(ctx => ctx.dispose())).then(() => {
            process.exit(0);
          });
        });
        
        return;
      } else {
        // Build all targets sequentially (non-watch mode)
        console.log('🚀 Building all targets...');
        
        for (const targetName of targets) {
          const config = buildConfigs[targetName];
          const buildOptions = createBuildOptions(config, args.production || args.minify);
          
          console.log(`\n📦 Building ${config.name.toLowerCase()}...`);
          await esbuild.build(buildOptions);
          
          // Post-build tasks for each target
          if (targetName === 'development') {
            generateTypeDeclarations();
            copyDevelopmentAssets();
          } else if (targetName === 'library' && config.outfile) {
            generateLibraryTypeDeclarations();
            showBuildStats(config.outfile, 'Library bundle');
          } else if (targetName === 'binary' && config.outfile) {
            makeExecutable(config.outfile);
            showBuildStats(config.outfile, 'Binary');
          } else if (targetName === 'web' && config.outfile) {
            showBuildStats(config.outfile, 'Web bundle');
          }
        }
        
        console.log('\n✅ All builds complete!');
        return;
      }
    }

    const config = buildConfigs[args.target];
    const buildOptions = createBuildOptions(config, args.production || args.minify);
    
    console.log(`Building ${config.name.toLowerCase()} version with esbuild...`);

    if (args.watch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      
      if (args.target === 'development') {
        copyDevelopmentAssets();
      }
      
      console.log('  Watching for changes...');
      await ctx.watch();

      // Keep the process running
      process.on('SIGINT', () => {
        console.log('\n   Stopping watch mode...');
        ctx.dispose();
        process.exit(0);
      });
    } else {
      // Single build
      await esbuild.build(buildOptions);

      // Post-build tasks
      if (args.target === 'development') {
        generateTypeDeclarations();
        copyDevelopmentAssets();
      } else if (args.target === 'library' && config.outfile) {
        generateLibraryTypeDeclarations();
        showBuildStats(config.outfile, 'Library bundle');
      } else if (args.target === 'binary' && config.outfile) {
        makeExecutable(config.outfile);
        showBuildStats(config.outfile, 'Binary');
      } else if (args.target === 'web' && config.outfile) {
        showBuildStats(config.outfile, 'Web bundle');
      }

      console.log('✅ Build complete!');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  build();
}