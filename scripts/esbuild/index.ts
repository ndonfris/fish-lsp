#!/usr/bin/env tsx

import { parseArgs, showCompletions, showHelp } from "./cli";
import { pipeline } from './pipeline';
import { startFileWatcher } from './file-watcher';
import { logger } from './colors';

export async function build(_customArgs?: string[]): Promise<void> {
  const args = parseArgs();

  // Handle help and completions                                               
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
    await startFileWatcher(args.watchMode);
    return;
  }

  try {
    // Execute the build pipeline for the target                               
    await pipeline.execute(args.target, args);
  } catch (error) {
    logger.logError('Build failed', error as Error);
    process.exit(1);
  }
}

// Auto-run if this file is executed directly                                  
if (require.main === module) {
  build();
}

