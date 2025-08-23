import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { colorize, colors, logger } from './colors';

interface WatcherOptions {
  watchPaths: string[];
  extensions: string[];
  ignorePatterns: string[];
  onRebuild: () => void | Promise<void>;
  debounceMs: number;
}

class FileWatcher {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private options: WatcherOptions;
  private rebuildCount: number = 0;
  private eventBatchTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();
  private recentlyChangedFiles: Map<string, number> = new Map();
  private readonly eventBatchWindowMs: number = 200;
  private readonly fileChangeThrottleMs: number = 1000;

  constructor(options: WatcherOptions) {
    this.options = options;
  }

  start(): void {
    console.log(logger.info('Starting comprehensive file watcher...'));
    console.log(logger.dim(`Watching: ${this.options.watchPaths.join(', ')}`));
    console.log(logger.dim(`Extensions: ${this.options.extensions.join(', ')}`));
    console.log(logger.dim(`Debounce: ${this.options.debounceMs}ms`));
    
    for (const watchPath of this.options.watchPaths) {
      this.watchPath(watchPath);
    }

    execSync('yarn dev', {
      stdio: 'inherit',
      cwd: process.cwd()
    })
    this.showRebuildCompletedMessage();

    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  private watchPath(watchPath: string): void {
    if (!fs.existsSync(watchPath)) {
      console.log(logger.warning(`Warning: Watch path does not exist: ${watchPath}`));
      return;
    }

    const stats = fs.statSync(watchPath);
    const isDirectory = stats.isDirectory();

    const watcher = fs.watch(watchPath, { recursive: isDirectory }, (_eventType, filename) => {
      let actualFilename: string;
      let actualFilePath: string;
      
      if (isDirectory) {
        if (!filename) return;
        actualFilename = filename;
        actualFilePath = path.join(watchPath, filename);
      } else {
        // For individual files, filename might be null, so use the watchPath itself
        actualFilename = path.basename(watchPath);
        actualFilePath = watchPath;
      }
      
      // Skip ignored patterns
      if (this.shouldIgnoreFile(actualFilePath, actualFilename)) {
        return;
      }

      // Check if file has watched extension
      if (!this.hasWatchedExtension(actualFilename)) {
        return;
      }

      this.handleFileChange(actualFilename, actualFilePath);
    });

    this.watchers.push(watcher);
  }

  private shouldIgnoreFile(filePath: string, filename: string): boolean {
    return this.options.ignorePatterns.some(pattern => {
      // Convert glob-like patterns to regex
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      
      const regex = new RegExp(regexPattern);
      return regex.test(filePath) || regex.test(filename);
    });
  }

  private hasWatchedExtension(filename: string): boolean {
    if (this.options.extensions.length === 0) return true;
    
    const ext = path.extname(filename).toLowerCase();
    return this.options.extensions.some(watchedExt => 
      watchedExt === ext || watchedExt === ext.substring(1) // handle both ".ts" and "ts"
    );
  }

  private handleFileChange(filename: string, filePath: string): void {
    const now = Date.now();
    
    // Check if this file was recently changed (throttle rapid events)
    const lastChangeTime = this.recentlyChangedFiles.get(filePath);
    if (lastChangeTime && (now - lastChangeTime) < this.fileChangeThrottleMs) {
      console.log(logger.dim(`⏭️  Skipping ${filename} (recently changed)`));
      return; // Skip this change - file was recently modified
    }
    
    // Update the last change time for this file
    this.recentlyChangedFiles.set(filePath, now);
    
    // Add to pending changes
    this.pendingChanges.add(filename);
    console.log(logger.dim(`📝 Queued: ${filename}`));
    
    // Clean up old entries from recentlyChangedFiles map (prevent memory leaks)
    this.cleanupRecentFiles(now);
    
    // Start or reset the event batch timer
    this.startEventBatch();
  }

  private cleanupRecentFiles(now: number): void {
    for (const [filePath, timestamp] of Array.from(this.recentlyChangedFiles.entries())) {
      if (now - timestamp > this.fileChangeThrottleMs * 2) {
        this.recentlyChangedFiles.delete(filePath);
      }
    }
  }

  private startEventBatch(): void {
    if (this.eventBatchTimer) {
      clearTimeout(this.eventBatchTimer);
    }

    this.eventBatchTimer = setTimeout(() => {
      this.processBatchedChanges();
    }, this.eventBatchWindowMs);
  }

  private processBatchedChanges(): void {
    if (this.pendingChanges.size === 0) return;
    
    const changedFiles = Array.from(this.pendingChanges).sort();
    this.pendingChanges.clear();
    
    console.log(logger.info(`📁 Files changed: ${changedFiles.join(', ')}`));
    this.triggerRebuild(changedFiles);
  }

  private readBuildTime(): string {
    try {
      const buildTimePath = path.join(process.cwd(), 'out', 'build-time.json');
      if (fs.existsSync(buildTimePath)) {
        const buildTimeData = JSON.parse(fs.readFileSync(buildTimePath, 'utf-8'));
        return buildTimeData.timestamp || buildTimeData.isoTimestamp;
      }
    } catch (error) {
      // Silently ignore errors reading build time
    }
    return 'unknown';
  }

  private showRebuildCompletedMessage(changedFiles?: string[]): void {
    this.rebuildCount++;
    const buildTime = this.readBuildTime();
    
    // Visual separator
    console.log(colorize('━'.repeat(80), colors.blue));
    console.log(colorize('Rebuild Completed', colors.bright));
    console.log(colorize('━'.repeat(80), colors.blue));
    console.log(colorize(`  Rebuild completed successfully! `, colors.white), colorize(`(${this.rebuildCount} total rebuilds)`, colors.blue));
    console.log(colorize(`  Build timestamp:`, colors.white), colorize(buildTime, colors.yellow));
    console.log(colorize(`  Total rebuilds during this watch session:`, colors.white), colorize(`${this.rebuildCount}`, colors.blue));
    if (changedFiles && changedFiles.length > 0) {
      console.log(colorize(`  Triggered by:`, colors.white), colorize(`${changedFiles.join(', ')}`, colors.magenta));
    }
    console.log(colorize('━'.repeat(80), colors.blue));
  }

  private triggerRebuild(changedFiles?: string[]): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      console.log(logger.building('Rebuilding due to file changes...'));
      try {
        await this.options.onRebuild();
        this.showRebuildCompletedMessage(changedFiles);
      } catch (error) {
        logger.logError('Rebuild failed', error as Error);
      }
    }, this.options.debounceMs);
  }

  stop(): void {
    console.log(logger.info('Stopping file watcher...'));
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.eventBatchTimer) {
      clearTimeout(this.eventBatchTimer);
    }

    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    this.pendingChanges.clear();
    this.recentlyChangedFiles.clear();
  }
}

export async function startFileWatcher(): Promise<void> {
  const onRebuild = async () => {
    // Execute the full dev command
    execSync('yarn dev', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
  };

  const watcher = new FileWatcher({
    watchPaths: [
      './src',
      './fish_files', 
      './scripts',
      './package.json',
      './tsconfig.json',
      './jest.config.js'
    ],
    extensions: ['.ts', '.js', '.json', '.fish', '.md'],
    ignorePatterns: [
      'node_modules/**',
      'out/**',
      'dist/**', 
      'lib/**',
      '.git/**',
      'coverage/**',
      '*.tgz',
      '.tsbuildinfo',
      'logs.txt',
      '**/*.map',
      '.bun/**'
    ],
    onRebuild,
    debounceMs: 1000
  });

  watcher.start();
  
  console.log(logger.success('File watcher started!'));
  console.log(logger.dim('Press Ctrl+C to stop'));
  
  // Keep process running
  return new Promise(() => {}); // Never resolves, keeps process alive
}
