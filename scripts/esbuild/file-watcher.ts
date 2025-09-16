import { spawn, ChildProcess } from 'child_process';
import { colorize, colors, logger } from './colors';
import chokidar from 'chokidar';

// Utility to kill process tree (handles child processes)
function killProcessTree(pid: number, signal: string = 'SIGTERM'): void {
  try {
    // On Unix systems, kill the process group
    if (process.platform !== 'win32') {
      // Kill the process group (negative PID targets the process group)
      process.kill(-pid, signal as any);
      // Also kill the main process directly as a fallback
      try {
        process.kill(pid, signal as any);
      } catch (e) {
        // Process may already be dead
      }
    } else {
      // On Windows, use taskkill to terminate the process tree
      const taskKillOptions = signal === 'SIGKILL' ? ['/pid', pid.toString(), '/T', '/F'] : ['/pid', pid.toString(), '/T'];
      spawn('taskkill', taskKillOptions, { stdio: 'ignore' });
    }
  } catch (error) {
    // Process may already be dead, ignore errors but try direct kill as fallback
    try {
      process.kill(pid, signal as any);
    } catch (e) {
      // Really dead now, ignore
    }
  }
}

// ============================================================================
// UI Helpers
// ============================================================================

const separator = () => {
  console.log(colorize('━'.repeat(80), colors.blue));
};

const showHelp = (currentMode?: BuildType) => {
  separator();
  console.log(logger.info(' Available Commands:'));
  console.log(logger.dim(' * h          - Show this help'));
  console.log(logger.dim(' * m          - Switch watch mode'));
  console.log(logger.dim(' * w          - Show watched file paths'));
  console.log(logger.dim(' * Enter/a/r  - Run current mode build'));
  console.log(logger.dim(' * b          - Binary-only rebuild (yarn build --npm)'));
  console.log(logger.dim(' * q/Ctrl+C   - Quit watch mode'));
  console.log('');
  if (currentMode) {
    console.log(logger.info(` Current Mode: ${getModeDisplayName(currentMode)}`));
  }
  separator();
};

const log = (...args: string[]) => {
  console.log(args.join(' '));
}

const getModeDisplayName = (mode: BuildType): string => {

  switch (mode) {
    case 'full':
      return 'Full Project (yarn dev)';
    case 'binary':
      return 'Binary Only (yarn build --npm)';
    case 'npm':
      return 'NPM Build (yarn build --npm)';
    case 'lint':
      return 'Lint Fix (yarn lint:fix)';
    default:
      return 'Full Project (yarn dev)';
  }
};

const showKeysReminder = (currentMode?: BuildType) => {
  const modeText = currentMode ? `[${getModeDisplayName(currentMode)}]` : '';
  console.log(logger.highlight(`Press "h" for help, "m" for mode switch, "Enter" to rebuild ${modeText}`));
};

// ============================================================================
// Build Manager - Handles all build operations consistently
// ============================================================================

type BuildType = 'full' | 'binary' | 'npm' | 'lint';
type BuildTrigger = 'file-change' | 'manual' | 'mode-switch';

class BuildManager {
  private currentProcess: ChildProcess | null = null;
  private isBuilding = false;
  private buildCount = 0;
  private currentMode: BuildType = 'full';

  async runBuild(type: BuildType, trigger: BuildTrigger): Promise<void> {
    if (this.isBuilding) {
      console.log(logger.dim('⏳ Build already in progress, please wait...'));
      return;
    }

    this.isBuilding = true;
    this.buildCount++;

    const command = this.getCommandForType(type);
    const buildName = this.getBuildNameForType(type);

    console.log(logger.info(`🔄 ${buildName} rebuild triggered (${trigger})...`));

    try {
      await this.executeCommand(['yarn', ...command]);
      this.showCompletionMessage(type, trigger, true);
    } catch (error) {
      this.showCompletionMessage(type, trigger, false, error as Error);
    } finally {
      this.isBuilding = false;
    }
  }

  private executeCommand(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      // Join the command and arguments into a single command string for shell execution
      const command = args.join(' ');
      this.currentProcess = spawn(command, [], {
        stdio: 'inherit',
        cwd: process.cwd(),
        shell: true,
        detached: process.platform !== 'win32', // Use process groups on Unix
        killSignal: 'SIGTERM'
      });

      // On Unix, create a new process group
      if (process.platform !== 'win32' && this.currentProcess.pid) {
        try {
          process.kill(this.currentProcess.pid, 0); // Check if process exists
        } catch (error) {
          // Process creation failed
          reject(error);
          return;
        }
      }

      this.currentProcess.on('close', (code: number) => {
        this.currentProcess = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      this.currentProcess.on('error', (error: Error) => {
        this.currentProcess = null;
        reject(error);
      });
    });
  }

  private showCompletionMessage(type: BuildType, trigger: BuildTrigger, success: boolean, error?: Error): void {
    separator();
    const buildName = this.getBuildNameForType(type);

    if (success) {
      console.log(colorize(`${buildName} Rebuild Completed`, colors.bright));
    } else {
      console.log(colorize(`${buildName} Rebuild Failed`, colors.red));
    }

    separator();

    if (success) {
      console.log(colorize(`  ${buildName} rebuild completed successfully!`, colors.white));
    } else if (error) {
      console.log(colorize(`  Rebuild failed:`, colors.red), colorize(error.message, colors.dim));
    }

    console.log(colorize(`  Build timestamp:`, colors.white), colorize(new Date().toLocaleTimeString(), colors.yellow));
    console.log(colorize(`  Total rebuilds:`, colors.white), colorize(`${this.buildCount}`, colors.blue));
    console.log(colorize(`  Trigger:`, colors.white), colorize(trigger, colors.magenta));
    console.log(colorize(`  Current mode:`, colors.white), colorize(getModeDisplayName(this.currentMode), colors.cyan));

    separator();
    showKeysReminder(this.currentMode);
  }

  cancel(): boolean {
    if (this.currentProcess && this.currentProcess.pid) {
      console.log(logger.warning('🛑 Cancelling current build...'));

      const pid = this.currentProcess.pid;

      // Kill the entire process tree (including child processes)
      killProcessTree(pid, 'SIGTERM');

      // Force kill after timeout if process doesn't exit
      const forceKillTimeout = setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) {
          console.log(logger.warning('🔥 Force killing build process tree...'));
          killProcessTree(pid, 'SIGKILL');
        }
      }, 2000); // 2 second timeout

      // Clear timeout if process exits normally
      this.currentProcess.on('exit', () => {
        clearTimeout(forceKillTimeout);
      });

      this.currentProcess = null;
      this.isBuilding = false;
      return true;
    }
    return false;
  }

  get building(): boolean {
    return this.isBuilding;
  }

  get mode(): BuildType {
    return this.currentMode;
  }

  setMode(mode: BuildType): void {
    this.currentMode = mode;
  }

  private getCommandForType(type: BuildType): string[] {
    switch (type) {
      case 'full':
        return ['dev'];
      case 'binary':
        return ['build', '--npm'];
      case 'npm':
        return ['build', '--npm'];
      case 'lint':
        return ['lint:fix'];
      default:
        return ['dev'];
    }
  }

  private getBuildNameForType(type: BuildType): string {
    switch (type) {
      case 'full':
        return 'Full';
      case 'binary':
        return 'Binary';
      case 'npm':
        return 'NPM';
      case 'lint':
        return 'Lint';
      default:
        return 'Full';
    }
  }
}

// ============================================================================
// File Watcher - Simplified using chokidar
// ============================================================================

interface WatchConfig {
  watchPaths: string[];
  ignorePatterns: string[];
  debounceMs: number;
}

class FileWatcher {
  // @ts-ignore
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly config: WatchConfig;
  private readonly buildManager: BuildManager;

  constructor(config: WatchConfig, buildManager: BuildManager) {
    this.config = config;
    this.buildManager = buildManager;
  }

  start(): void {
    console.log(logger.info('Starting file watcher...'));
    console.log(logger.dim(`Current working directory: ${process.cwd()}`));
    console.log(logger.dim(`Watching: ${this.config.watchPaths.join(', ')}`));
    console.log(logger.dim(`Debounce: ${this.config.debounceMs}ms`));

    const toAdd: string[] = []
    // Debug: test if patterns match any files
    const glob = require('fast-glob');
    console.log(logger.dim('Testing glob patterns:'));
    this.config.watchPaths.forEach(pattern => {
      try {
        const matches = glob.sync(pattern, { ignore: this.config.ignorePatterns });
        console.log(logger.dim(`  ${pattern} -> ${matches.length} files`));
        matches.forEach((m: string) => {
          if (!toAdd.includes(m)) {
            toAdd.push(m);
          }
        })
      } catch (e) {
        console.log(logger.dim(`  ${pattern} -> ERROR: ${e.message}`));
      }
    });

    // Create chokidar watcher with globbing enabled
    this.watcher = chokidar.watch(toAdd, {
      ignored: this.config.ignorePatterns,
      ignoreInitial: true,
      persistent: true,
      disableGlobbing: true, // We already resolved globs with fast-glob
      usePolling: false,
      useFsEvents: true // Use native filesystem events for better case sensitivity
    });

    // Run initial build in current mode
    this.buildManager.runBuild(this.buildManager.mode, 'file-change');

    // Set up event handlers
    this.watcher
      .on('ready', () => {
        console.log(logger.success('File watcher ready and monitoring for changes'));
        // Debug: show what files are being watched
        const watchedPaths = this.watcher?.getWatched();
        if (watchedPaths) {
          const totalFiles = Object.values(watchedPaths).reduce((sum: number, files) => Array.isArray(files) ? sum + files.length : sum, 0);
          console.log(logger.dim(`Watching ${totalFiles} files across ${Object.keys(watchedPaths).length} directories`));
          // Show first few watched files for debugging
          // console.log(logger.dim('Sample watched paths:'));
          // Object.keys(watchedPaths).slice(0, 5).forEach(dir => {
          //   const files = watchedPaths[dir].slice(0, 3);
          //   console.log(logger.dim(`  ${dir}: ${files.join(', ')}${watchedPaths[dir].length > 3 ? '...' : ''}`));
          // });
        }
      })
      .on('change', (path: string) => {
        log(colorize(logger.dim(`  File changed:`), colors.green), colorize(logger.bold(path), colors.yellow));
        this.handleFileChange('change', path);
      })
      .on('add', (path: string) => {
        log(colorize(logger.dim(`➕ File added:`), colors.green), logger.bold(path));
        this.handleFileChange('add', path);
      })
      .on('unlink', (path: string) => {
        log(colorize(logger.dim(`➖ File removed:`), colors.red), (logger.highlight(`${path}`)));
        this.handleFileChange('unlink', path);
      })
      .on('addDir', (path: string) => {
        log(colorize(logger.dim(`➕ Directory added`), colors.green), logger.bold(path));
        this.handleFileChange('addDir', path);
      })
      .on('unlinkDir', (path: string) => {
        log(colorize(logger.dim(`➖ Directory removed`), colors.red), logger.bold(path));
        this.handleFileChange('unlinkDir', path);
      })
      .on('error', (error: Error) => {
        console.error(logger.error('File watcher error:'), error);
      });
  }

  private handleFileChange(event: string, filePath: string): void {
    // Extract filename for display
    const filename = filePath.split('/').pop() || filePath;

    log(colorize(`   ${event}:`, colors.white), colorize(filename, colors.yellow));

    // Debounce rebuilds - clear existing timer and set new one
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      console.log(logger.building('Rebuilding due to file changes...'));
      await this.buildManager.runBuild(this.buildManager.mode, 'file-change');
    }, this.config.debounceMs);
  }

  showWatchedPaths(): void {
    if (!this.watcher) {
      console.log(logger.warning('File watcher is not active'));
      return;
    }

    const watchedPaths = this.watcher.getWatched();
    if (!watchedPaths) {
      console.log(logger.warning('No watched paths available'));
      return;
    }

    separator();
    console.log(logger.info('Currently Watched Files:'));
    separator();

    const totalFiles = Object.values(watchedPaths).reduce((sum, files) => sum + files.length, 0);
    const totalDirs = Object.keys(watchedPaths).length;

    console.log(logger.dim(`Total: ${totalFiles} files across ${totalDirs} directories`));
    console.log('');

    // Group and display by directory
    Object.keys(watchedPaths).sort().forEach(dir => {
      const files = watchedPaths[dir];
      if (files.length > 0) {
        console.log(colorize(dir, colors.blue));
        files.forEach(file => {
          console.log(logger.dim(`  ${file}`));
        });
        console.log('');
      }
    });

    separator();
  }

  stop(): void {
    console.log(logger.info('Stopping file watcher...'));

    // Cancel any running build
    this.buildManager.cancel();

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close chokidar watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

// ============================================================================
// Keyboard Handler - Simplified input handling
// ============================================================================

class KeyboardHandler {
  private readonly buildManager: BuildManager;
  private readonly fileWatcher: FileWatcher;

  constructor(buildManager: BuildManager, fileWatcher: FileWatcher) {
    this.buildManager = buildManager;
    this.fileWatcher = fileWatcher;
  }

  setup(): void {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', this.handleKeyPress.bind(this));
    process.stdin.on('error', (err) => {
      console.error('Error reading stdin:', err);
    });
  }

  private async handleKeyPress(key: string): Promise<void> {
    const keyCode = key.toLowerCase();

    switch (keyCode) {
      case '\u0003': // Ctrl+C
      case 'q':
        this.exit();
        break;

      case 'h':
        showHelp(this.buildManager.mode);
        break;

      case 'm':
        await this.showModeSelection();
        break;

      case 'w':
        this.fileWatcher.showWatchedPaths();
        break;

      case 'b':
        await this.buildManager.runBuild('binary', 'manual');
        break;

      case '\r': // Enter
      case '\n':
      case 'a':
      case 'r':
        await this.buildManager.runBuild(this.buildManager.mode, 'manual');
        break;

      default:
        // Ignore other keys
        break;
    }
  }

  private async showModeSelection(): Promise<void> {
    console.log('\n' + colorize('Select Watch Mode:', colors.bright));
    console.log(logger.dim('1. Full Project (yarn dev)'));
    console.log(logger.dim('2. NPM Build (yarn build --npm)'));
    console.log(logger.dim('3. Lint Fix (yarn lint:fix)'));
    console.log(logger.dim('Current: ' + getModeDisplayName(this.buildManager.mode)));
    console.log(logger.highlight('Enter number (1-3) or press any other key to cancel:'));

    // Set up temporary key listener for mode selection
    const modeSelectionHandler = (key: string) => {
      process.stdin.removeListener('data', modeSelectionHandler);

      const choice = key.trim();
      let newMode: BuildType | null = null;

      switch (choice) {
        case '1':
          newMode = 'full';
          break;
        case '2':
          newMode = 'npm';
          break;
        case '3':
          newMode = 'lint';
          break;
        default:
          console.log(logger.dim('Mode selection cancelled.'));
          showKeysReminder(this.buildManager.mode);
          return;
      }

      if (newMode && newMode !== this.buildManager.mode) {
        this.buildManager.setMode(newMode);
        console.log(logger.success(`Switched to: ${getModeDisplayName(newMode)}`));
        console.log(logger.info('File changes will now trigger: ' + getModeDisplayName(newMode)));
      } else if (newMode === this.buildManager.mode) {
        console.log(logger.dim('Already in that mode.'));
      }

      separator();
      showKeysReminder(this.buildManager.mode);
    };

    process.stdin.once('data', modeSelectionHandler);
  }

  private exit(): void {
    console.log('\n' + logger.warning('🛑 Exiting watch mode...'));

    // Restore stdin
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    // Stop file watcher
    this.fileWatcher.stop();

    process.exit(0);
  }
}

// ============================================================================
// Main Export - Simple interface
// ============================================================================

export async function startFileWatcher(): Promise<void> {
  // Create managers
  const buildManager = new BuildManager();

  const fileWatcher = new FileWatcher({
    watchPaths: [
      'src/*.ts',
      'src/**/*.ts',
      'src/**/*.json',
      'fish_files/**/*',
      'scripts/**/*.ts',
      'scripts/**/*',
      'scripts/*.fish',
      'fish_files/*.fish',
      'package.json',
      'tsconfig.json',
      'vitest.config.ts'
    ],
    ignorePatterns: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/lib/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.tgz',
      '**/.tsbuildinfo',
      '**/logs.txt',
      '**/*.map',
      '**/.bun/**',
      // Additional common ignores
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.tmp',
      '**/*.temp'
    ],
    debounceMs: 1000,
  }, buildManager);

  const keyboardHandler = new KeyboardHandler(buildManager, fileWatcher);

  // Setup comprehensive signal handling
  const cleanup = (signal: string) => {
    console.log(`\n${logger.info(`Received ${signal}, cleaning up...`)}`);

    // Cancel any running builds first
    buildManager.cancel();

    // Stop file watcher
    fileWatcher.stop();

    // Force exit to ensure we don't hang
    setTimeout(() => {
      process.exit(1);
    }, 1000);

    // Exit cleanly
    process.exit(0);
  };

  // Handle various termination signals
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGHUP', () => cleanup('SIGHUP'));

  // Handle uncaught exceptions to prevent zombie processes
  process.on('uncaughtException', (error) => {
    console.error(logger.error('Uncaught exception:'), error);
    cleanup('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error(logger.error('Unhandled rejection at:'), promise, 'reason:', reason);
    cleanup('unhandledRejection');
  });

  // Start everything
  fileWatcher.start();
  keyboardHandler.setup();

  console.log(logger.success('File watcher started!'));
  console.log(logger.info(`Current mode: ${getModeDisplayName(buildManager.mode)}`));
  separator();
  showKeysReminder(buildManager.mode);
  separator();

  // Keep process running
  return new Promise(() => { }); // Never resolves
}
