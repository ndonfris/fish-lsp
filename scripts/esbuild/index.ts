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
import { generateTypeDeclarations, copyDevelopmentAssets, showBuildStats, makeExecutable } from './utils';

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