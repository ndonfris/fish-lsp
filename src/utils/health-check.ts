import * as fs from 'fs';
// import * as os from 'os';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import { initializeParser } from '../parser';
import { execAsyncFish } from './exec';
import { SyncFileHelper } from './file-operations';

export async function performHealthCheck() {
  logger.logToStdout('fish-lsp health check\n' + '='.repeat(20));

  // Check if fish shell is available
  try {
    const fishVersion = (await execAsyncFish('fish --version | string match -r "\\d.*\\$"')).stdout.toString().trim();
    logger.logToStdout(`✓ fish shell: v${fishVersion}`);
  } catch (error) {
    logger.logToStdout('✗ fish shell not found or not working correctly');
    process.exit(1);
  }

  // Check tree-sitter
  try {
    await initializeParser().then(() => {
      logger.logToStdout('✓ tree-sitter initialized successfully');
    });
  } catch (e: any) {
    logger.logToStdout(`✗ tree-sitter initialization failed: ${e.message}`);
    process.exit(1);
  }

  // Check file permissions
  await logFishLspConfig();

  // Check log file
  if (config.fish_lsp_log_file) {
    try {
      const logDir = path.dirname(config.fish_lsp_log_file);
      await fs.promises.access(logDir, fs.constants.W_OK);
      logger.logToStdout(`✓ log directory is writable: ${logDir}`);
    } catch (error) {
      logger.logToStdout(`✗ cannot write to log directory: ${path.dirname(config.fish_lsp_log_file)}`);
    }
  }

  // Memory usage
  const memoryUsage = process.memoryUsage();
  logger.logToStdout('\nmemory usage:');
  logger.logToStdout(`  rss: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB`);
  logger.logToStdout(`  heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`);
  logger.logToStdout(`  heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);

  // System information
  logger.logToStdout('\nsystem information:');
  logger.logToStdout(`  platform: ${process.platform}`);
  logger.logToStdout(`  node.js: ${process.version}`);
  logger.logToStdout(`  architecture: ${process.arch}`);

  logger.logToStdout('\nall checks completed!');
}

async function logFishLspConfig() {
  logger.logToStdout('\nfish_lsp_all_indexed_paths:');
  for (const path of config.fish_lsp_all_indexed_paths) {
    const expanded_path = SyncFileHelper.expandEnvVars(path);
    if (fs.statSync(expanded_path).isDirectory()) {
      logger.logToStdout(`✓ fish-lsp workspace '${path}' is a directory`);
    } else {
      logger.logToStdout(`✗ fish-lsp workspace '${path}' is not a directory`);
    }
    try {
      await fs.promises.access(expanded_path, fs.constants.R_OK);
      logger.logToStdout(`✓ fish-lsp workspace '${path}' is readable`);
    } catch (error) {
      logger.logToStdout(`✗ fish-lsp workspace '${path}' is not readable`);
    }
    try {
      await fs.promises.access(expanded_path, fs.constants.W_OK);
      logger.logToStdout(`✓ fish-lsp workspace '${path}' is writable`);
    } catch (error) {
      logger.logToStdout(`✗ fish-lsp workspace '${path}' is not writable`);
    }
  }
}
