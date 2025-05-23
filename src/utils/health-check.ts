import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import { initializeParser } from '../parser';
import { execAsyncFish } from './exec';
import { SyncFileHelper } from './file-operations';
import { env } from './env-manager';
import { PackageVersion } from './commander-cli-subcommands';

export async function performHealthCheck() {
  logger.logToStdout('fish-lsp health check');
  logger.logToStdout('='.repeat(21));

  // check info about the fish-lsp binary
  logger.logToStdout('\nchecking `fish-lsp` command:');
  try {
    const fishLspVersion = PackageVersion;
    logger.logToStdout(`✓ fish-lsp version: v${fishLspVersion}`);
  } catch (error) {
    logger.logToStdout('✗ fish-lsp version not found');
  }

  // check if fish-lsp binary is in path
  try {
    const fishLspPath = (await execAsyncFish('command -v fish-lsp')).stdout.toString().trim();
    if (!fishLspPath) {
      logger.logToStdout(`✓ fish-lsp binary found: ${fishLspPath}`);
    } else {
      logger.logToStdout('✗ fish-lsp binary not found in path');
    }
  } catch (error) {
    logger.logToStdout('✗ fish-lsp binary not found in path');
    process.exit(1);
  }

  logger.logToStdout('\nchecking dependencies:');
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

  if (isNodeVersionGreaterThan18()) {
    logger.logToStdout(`✓ node version satisfies minimum version 18 (current version: ${process.versions.node})`);
  } else {
    logger.logToStdout(`✓ node version doesn't satisfy minimum version 18 (current version: ${process.versions.node})`);
  }

  // Check file permissions
  await logFishLspConfig();

  // Check log file
  logger.logToStdout('\nchecking log file:');
  if (config.fish_lsp_log_file) {
    logger.logToStdout(`✓ log file found: ${config.fish_lsp_log_file}`);
    try {
      const logDir = path.dirname(config.fish_lsp_log_file);
      await fs.promises.access(logDir, fs.constants.W_OK);
      logger.logToStdout(`✓ log directory is writable: ${logDir}`);
    } catch (error) {
      logger.logToStdout(`✗ cannot write to log directory: ${path.dirname(config.fish_lsp_log_file)}`);
    }
  } else {
    logger.logToStdout('✗ log file not specified');
  }

  try {
    logger.logToStdout('\nchecking for fish-lsp completions:');
    const completions = (await execAsyncFish('path sort --unique --key=basename $fish_complete_path/*.fish | string match -re "fish-lsp.fish\\$"')).stdout.toString().trim();
    if (completions) {
      logger.logToStdout(`✓ completions file found: ${completions}`);
    } else {
      logger.logToStdout('✗ completions file not found');
    }

    try {
      const completionsEqual = await execAsyncFish(`fish-lsp complete | command diff ${completions} -`);
      if (completionsEqual.stdout.toString().trim() === '') {
        logger.logToStdout('✓ completions file is up to date');
      } else {
        logger.logToStdout('✗ completions file is not up to date');
      }
    } catch (error) {
      logger.logToStdout('✗ completions file is not up to date');
    }
  } catch (error) {
    logger.logToStdout('✗ completion file not found');
  }

  try {
    logger.logToStdout('\nchecking for fish-lsp man page:');
    const manFile = await execAsyncFish('man fish-lsp 2>/dev/null | command cat | count');
    const manFilePath = (await execAsyncFish('man -w fish-lsp 2> /dev/null')).stdout.toString().trim();
    if (manFile.stdout && parseInt(manFile.stdout.toString().trim()) > 1 && manFilePath !== '') {
      logger.logToStdout(`✓ man file found: ${manFilePath}`);
    } else {
      logger.logToStdout('✗ man file not found');
    }
  } catch (error) {
    logger.logToStdout('✗ man file not found');
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
  const dataDir = env.getFirstValueInArray('__fish_data_dir');
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
      if (expanded_path === dataDir) {
        logger.logToStdout(`✗ fish-lsp workspace '${path}' is not writable (this is expected)`);
      } else {
        logger.logToStdout(`✗ fish-lsp workspace '${path}' is not writable`);
      }
    }
  }
}

function isNodeVersionGreaterThan18() {
  const currentVersion = process.versions.node;
  const majorVersion = parseInt(currentVersion.split('.')[0]!, 10);
  return majorVersion >= 18;
}
