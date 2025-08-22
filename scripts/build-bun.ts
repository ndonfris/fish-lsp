#!/usr/bin/env bun

import { buildTargets, createBunBuildOptions, type BuildTarget } from '../bun.config';
import { existsSync, chmodSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

interface BuildArgs {
  target: string;
  production: boolean;
  watch: boolean;
  all: boolean;
}

function parseArgs(): BuildArgs {
  const args = process.argv.slice(2);
  return {
    target: args.find(arg => !arg.startsWith('--')) || 'development',
    production: args.includes('--production') || args.includes('--prod'),
    watch: args.includes('--watch') || args.includes('-w'),
    all: args.includes('--all'),
  };
}

function makeExecutable(filePath: string) {
  try {
    chmodSync(filePath, 0o755);
    console.log(`✅ Made ${filePath} executable`);
  } catch (error) {
    console.warn(`⚠️  Could not make ${filePath} executable:`, error);
  }
}

function copyAssets(target: BuildTarget) {
  // Copy any necessary assets based on target
  if (target.name === 'Binary') {
    // Ensure the binary has executable permissions
    if (target.outfile) {
      makeExecutable(target.outfile);
    }
  }
}

async function buildTarget(targetName: string, config: BuildTarget, production: boolean) {
  console.log(`🔨 Building ${config.name}...`);
  
  const buildOptions = createBunBuildOptions(config, production);
  
  // Ensure output directory exists
  if (config.outfile) {
    const outDir = dirname(config.outfile);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }
  }
  
  try {
    const startTime = Date.now();
    
    // Use Bun.build for bundling
    const result = await Bun.build(buildOptions);
    
    if (!result.success) {
      console.error(`❌ Build failed for ${config.name}:`);
      for (const log of result.logs) {
        console.error(log);
      }
      process.exit(1);
    }
    
    const buildTime = Date.now() - startTime;
    console.log(`✅ ${config.name} built successfully in ${buildTime}ms`);
    
    // Post-build tasks
    copyAssets(config);
    
    return result;
  } catch (error) {
    console.error(`❌ Build failed for ${config.name}:`, error);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs();
  
  console.log('🚀 Bun Bundler for fish-lsp');
  
  if (args.all) {
    // Build all targets
    const targets = Object.keys(buildTargets);
    console.log(`📦 Building all targets: ${targets.join(', ')}`);
    
    for (const targetName of targets) {
      const config = buildTargets[targetName];
      await buildTarget(targetName, config, args.production);
    }
    
    console.log('🎉 All builds completed successfully!');
  } else {
    // Build single target
    const config = buildTargets[args.target];
    if (!config) {
      console.error(`❌ Unknown target: ${args.target}`);
      console.error(`Available targets: ${Object.keys(buildTargets).join(', ')}`);
      process.exit(1);
    }
    
    if (args.watch) {
      console.log(`👀 Watching ${config.name} for changes...`);
      // Note: Bun's watch mode would need to be implemented with file system watchers
      // For now, just do a single build
      console.log('⚠️  Watch mode not yet implemented with Bun - performing single build');
    }
    
    await buildTarget(args.target, config, args.production);
  }
}

// Run if this is the main module
if (import.meta.main) {
  main().catch(console.error);
}

export { buildTarget, main as build };