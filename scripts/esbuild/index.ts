#!/usr/bin/env tsx

import * as esbuild from 'esbuild';

// Re-export utilities
export * from './plugins';
export * from './configs';
export * from './utils';
export * from './cli';
export * from "./colors";
export * from "./types";

// Import everything we need for the main build function
import { parseArgs, showCompletions, showHelp } from "./cli";
import { ALL_TARGETS, BuildConfigTarget, isBuildConfigTarget, getTargetDisplayName } from "./types";
import { buildConfigs, createBuildOptions } from './configs';
import { generateTypeDeclarations, generateLibraryTypeDeclarations, copyDevelopmentAssets, showBuildStats, makeExecutable } from './utils';
import { logger } from './colors';
import { startFileWatcher } from './file-watcher';
import { existsSync, readFileSync, writeFileSync } from 'fs';


/**
 * Main build function - can be called programmatically or from CLI
 */
export async function build(customArgs?: string[]): Promise<void> {
  const args = parseArgs();
  
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  if (process.argv.includes('--completions') || process.argv.includes('-c')) {
    showCompletions();
    process.exit(0);
  }

  // Handle comprehensive file watching
  if (args.watchAll) {
    console.log(logger.header('`fish-lsp` comprehensive file watcher'));
    console.log(logger.info('Starting comprehensive file watcher...'));
    console.log(logger.dim('This will watch src/**, fish_files/*, package.json, and other relevant files'));
    console.log(logger.dim('Any change will trigger a full `yarn dev` rebuild'));
    await startFileWatcher();
    return;
  }

  try {
    if (args.target === 'all') {
      const targets = ALL_TARGETS;
      
      if (args.watch) {
        // Watch mode for all targets
        console.log(logger.header('`fish-lsp` esbuild (BUILD SYSTEM)'));
        console.log(logger.info('  Starting watch mode for all targets...  '));
        const contexts: esbuild.BuildContext[] = [];
        
        for (let i = 0; i < targets.length; i++) {
          const targetName = targets[i];
          const config = buildConfigs[targetName];
          const buildOptions = createBuildOptions(config, args.production || args.minify);
          
          console.log(`\n${logger.step(i + 1, targets.length, logger.building(config.name))}`);
          const ctx = await esbuild.context(buildOptions);
          contexts.push(ctx);
          
          // Post-build tasks for initial build
          if (targetName === 'development') {
            generateTypeDeclarations();
            copyDevelopmentAssets();
          } else if (targetName === 'binary' && config.outfile) {
            await generateLibraryTypeDeclarations();
            makeExecutable(config.outfile);
          }
          
          await ctx.watch();
          console.log(logger.watching(config.name));
        }
        
        console.log(`\n${logger.info('   All targets are now being watched for changes...   ')}`);
        console.log(logger.dim('Press Ctrl+C to stop'));
        
        // Keep the process running and handle cleanup
        process.on('SIGINT', () => {
          console.log(`\n${logger.warning('🛑 Stopping watch mode...')}`);
          Promise.all(contexts.map(ctx => ctx.dispose())).then(() => {
            console.log(logger.success('✨ Watch mode stopped cleanly'));
            process.exit(0);
          });
        });
        
        return;
      } else {
        // Build all targets sequentially (non-watch mode)
        console.log(logger.header('`fish-lsp` esbuild (BUILD SYSTEM)'));
        console.log(logger.info('Building all targets... '), logger.bold(''));
        
        for (let i = 0; i < targets.length; i++) {
          const targetName = targets[i];
          const config = buildConfigs[targetName];
          const buildOptions = createBuildOptions(config, args.production || args.minify);
          
          console.log(`\n${logger.step(i + 1, targets.length, logger.building(config.name))}`);
          const startTime = Date.now();
          
          await esbuild.build(buildOptions);
          
          const buildTime = Date.now() - startTime;
          console.log(logger.success(`✨ ${config.name} built in ${buildTime} ms`));
          
          // Post-build tasks for each target
          if (targetName === 'development') {
            generateTypeDeclarations();
            copyDevelopmentAssets();
          } else if (targetName === 'binary' && config.outfile) {
            await generateLibraryTypeDeclarations();
            makeExecutable(config.outfile);
            showBuildStats(config.outfile, 'Binary');
          } else if (targetName === 'web' && config.outfile) {
            showBuildStats(config.outfile, 'Web bundle');
          }
        }
        
        console.log(`\n${logger.success('  All builds completed successfully!')}`);
        return;
      }
    }

    // Handle types-only build
    if (args.target === 'types') {
      console.log(logger.header('`fish-lsp` TypeScript Declarations'));
      console.log(logger.info('Generating bundled TypeScript declaration files...'));
      
      generateTypeDeclarations();
      
      console.log(logger.success('✨ TypeScript declarations completed!'));
      return;
    }

    // Ensure we have a valid build config target
    if (!isBuildConfigTarget(args.target)) {
      throw new Error(`Invalid target: ${args.target}. Must be one of: ${ALL_TARGETS.join(", ")}`);
    }

    const config = buildConfigs[args.target];
    const buildOptions = createBuildOptions(config, args.production || args.minify);
    
    console.log(logger.header('`fish-lsp` esbuild (BUILD SYSTEM)'));
    console.log(logger.building(config.name));

    if (args.watch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      
      if (args.target === 'development') {
        copyDevelopmentAssets();
      }
      
      console.log(logger.watching(config.name));
      console.log(logger.dim('Press Ctrl+C to stop'));
      await ctx.watch();

      // Keep the process running
      process.on('SIGINT', () => {
        console.log(`\n${logger.warning('🛑 Stopping watch mode...')}`);
        ctx.dispose();
        console.log(logger.success('✨ Watch mode stopped cleanly'));
        process.exit(0);
      });
    } else {
      // Single build
      const startTime = Date.now();
      await esbuild.build(buildOptions);
      const buildTime = Date.now() - startTime;
      
      console.log(logger.success(`✨ ${config.name} built in ${buildTime} ms`));

      // Post-build tasks
      if (args.target === 'development') {
        generateTypeDeclarations();
        copyDevelopmentAssets();
      } else if (args.target === 'binary' && config.outfile) {
        await generateLibraryTypeDeclarations();
        makeExecutable(config.outfile);
        showBuildStats(config.outfile, 'Binary');
      } else if (args.target === 'web' && config.outfile) {
        showBuildStats(config.outfile, 'Web bundle');
      }

      console.log(logger.success('  Build completed successfully!'));
    }
  } catch (error) {
    logger.logError('Build failed', error as Error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly
if (require.main === module) {
  build();
}
