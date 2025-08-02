import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import { initializeParser } from '../parser';
import { execAsyncFish } from './exec';
import { SyncFileHelper } from './file-operations';
import { env } from './env-manager';
import { DepVersion, PkgJson } from './commander-cli-subcommands';

export async function performHealthCheck() {
  logger.logToStdout('fish-lsp health check');
  logger.logToStdout('='.repeat(21));

  // check info about the fish-lsp binary
  logger.logToStdout('\nchecking `fish-lsp` command:');
  try {
    const fishLspVersion = PkgJson.version;
    logger.logToStdout(`✓ fish-lsp version: v${fishLspVersion}`);
  } catch (error) {
    logger.logToStdout('✗ fish-lsp version not found');
  }

  // check if fish-lsp binary is in path
  try {
    const fishLspPath = (await execAsyncFish('command -v fish-lsp')).stdout.toString().trim();
    if (fishLspPath) {
      logger.logToStdout(`✓ fish-lsp binary found: ${fishLspPath}`);
    } else {
      logger.logToStdout('✗ fish-lsp binary not found in PATH');
    }
  } catch (error) {
    logger.logToStdout('✗ fish-lsp binary not found in PATH');
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

  if (isNodeVersionGreaterThanMinimumRequiredVersion()) {
    logger.logToStdout(`✓ node version satisfies minimum version '>=${PkgJson.node.raw}' (current version: ${process.versions.node})`);
  } else {
    logger.logToStdout(`✗ node version doesn't satisfy minimum version '>=${PkgJson.node.raw}' (current version: ${process.versions.node})`);
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
    logger.logToStdout('\nchecking completions:');
    const completions = (await execAsyncFish('path sort --unique --key=basename $fish_complete_path/*.fish | string match -re "\./fish-lsp.fish\\$"')).stdout.toString().trim();
    if (completions) {
      logger.logToStdout(`✓ completions file found: ${completions}`);
    } else {
      CheckHealthErrorMessages.completionsFile.globalNotFound();
    }

    try {
      const completionsEqual = await execAsyncFish(`fish-lsp complete | command diff ${completions} -`);
      if (completionsEqual.stdout.toString().trim() === '') {
        logger.logToStdout('✓ completions file is up to date');
      } else {
        CheckHealthErrorMessages.completionsFile.notUpToDate();
      }
    } catch (error) {
      CheckHealthErrorMessages.completionsFile.notUpToDate();
    }
  } catch (error) {
    CheckHealthErrorMessages.completionsFile.globalNotFound();
  }

  try {
    logger.logToStdout('\nchecking man page:');
    const manFile = await execAsyncFish('man fish-lsp 2>/dev/null | command cat | count');
    const manFilePath = (await execAsyncFish('man -w fish-lsp 2> /dev/null')).stdout.toString().trim();
    if (manFile.stdout && parseInt(manFile.stdout.toString().trim()) > 1 && manFilePath !== '') {
      logger.logToStdout(`✓ global man file found: ${manFilePath}`);
    } else {
      CheckHealthErrorMessages.manFile.globalNotFound();
    }

    try {
      const binManFilePath = (await execAsyncFish('fish-lsp info --man-file')).stdout.toString().trim();
      if (binManFilePath !== '') {
        logger.logToStdout(`✓ binary man file found: ${binManFilePath}`);
        try {
          const manDiff = (await execAsyncFish(`command diff ${binManFilePath} ${manFilePath}`)).stdout.toString().trim();
          if (manDiff === '') {
            logger.logToStdout('✓ global man file is up to date');
          } else {
            CheckHealthErrorMessages.manFile.notUpToDate();
          }
        } catch (error) {
          CheckHealthErrorMessages.manFile.notUpToDate();
        }
      } else {
        logger.logToStdout('✗ binary man file not found');
      }
    } catch (error) {
      logger.logToStdout('✗ binary man file not found');
    }
  } catch (error) {
    CheckHealthErrorMessages.manFile.globalNotFound();
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

namespace CheckHealthErrorMessages {

  export const completionsFile = {
    notUpToDate: () => {
      logger.logToStdout('✗ completions file is not up to date');
      logger.logToStderr('\nTO UPDATE COMPLETIONS FILE, RUN: ');
      logger.logToStderr([
        '```fish',
        'fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish',
        'source ~/.config/fish/completions/fish-lsp.fish',
        '```',
      ].join('\n'));
    },
    globalNotFound: () => {
      logger.logToStdout('✗ completions file not found');
      logger.logToStderr('\nPLEASE INCLUDE `fish-lsp complete | source` IN YOUR $fish_complete_path\n');
      logger.logToStderr('OR RUN:');
      logger.logToStderr([
        '```fish',
        'fish-lsp complete > ~/.config/fish/completions/fish-lsp.fish',
        'source ~/.config/fish/completions/fish-lsp.fish',
        '```',
      ].join('\n'));
    },
  };

  export const manFile = {
    notUpToDate: () => {
      logger.logToStdout('✗ global man file is not up to date');
      logger.logToStderr('\nTO UPDATE MAN FILE, RUN: ');
      logger.logToStderr([
        '```fish',
        'set global_man_file (path filter -f -- $MANPATH/*/fish-lsp.1)',
        'if ![ -f $global_man_file ]',
        '    echo "\$MANFILE does not contain \'fish-lsp.1\'" >&2',
        '    return 1',
        'end',
        '[ -f $(fish-lsp info --man-file) ] && cp $(fish-lsp info --man-file) $global_man_file -f && echo \'finished\'',
        'or cp $(fish-lsp info --man-file) $global_man_file -f && echo \'finished\'',
        'or echo "failed"',
        '```',
      ].join('\n'));
    },
    globalNotFound: () => {
      logger.logToStdout('✗ global man file not found');
      logger.logToStderr('\nPLEASE INCLUDE `fish-lsp info --man-file` IN YOUR $MANPATH\n');
    },
  };
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

function isNodeVersionGreaterThanMinimumRequiredVersion() {
  const currentVersion = process.versions.node;
  const currentParsed = DepVersion.extract(currentVersion);
  if (!currentParsed) {
    logger.logToStdout(`✗ could not parse current node version: ${currentVersion}`);
    return false;
  }
  const minimumVersion = PkgJson.node;
  return DepVersion.satisfies(currentParsed, minimumVersion);
}
