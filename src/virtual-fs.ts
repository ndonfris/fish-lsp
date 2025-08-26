import * as fs from 'fs';
import path, { resolve, join } from 'path';
import { Volume } from 'memfs';
import { tmpdir } from 'os';

// Import all embedded fish scripts
import execFishContent from '@embedded_assets/fish_files/exec.fish';
import expandCartesianContent from '@embedded_assets/fish_files/expand_cartesian.fish';
import getAutoloadedFilepathContent from '@embedded_assets/fish_files/get-autoloaded-filepath.fish';
import getCommandOptionsContent from '@embedded_assets/fish_files/get-command-options.fish';
import getCompletionContent from '@embedded_assets/fish_files/get-completion.fish';
import getDependencyContent from '@embedded_assets/fish_files/get-dependency.fish';
import getDocumentationContent from '@embedded_assets/fish_files/get-documentation.fish';
import getFishAutoloadedPathsContent from '@embedded_assets/fish_files/get-fish-autoloaded-paths.fish';
import getTypeVerboseContent from '@embedded_assets/fish_files/get-type-verbose.fish';
import getTypeContent from '@embedded_assets/fish_files/get-type.fish';
import packageJson from '@package';
import buildTime from '@embedded_assets/build-time.json';
import manPageContent from '@embedded_assets/man/fish-lsp.1';
import treeSitterFishWasmContent from '@embedded_assets/tree-sitter-fish.wasm';
import treeSitterCoreWasmContent from '@embedded_assets/tree-sitter.wasm';
// import treeSitterWasm from 'web-tree-sitter/tree-sitter.wasm'
import { existsSync } from 'fs';
import { promisify } from 'util';
import { execFile, execFileSync } from 'child_process';
const execAsync = promisify(execFile);

// Import fish-specific WASM file
// let treeSitterFishWasmContent = '';
// try {
//   treeSitterFishWasmContent = require('@embedded_assets/tree-sitter-fish.wasm').default || require('@embedded_assets/tree-sitter-fish.wasm');
// } catch {
//   // WASM file not embedded or not available
// }
//
// // Import man file
// let manPageContent = '';
// try {
//   manPageContent = require('@embedded_assets/man/fish-lsp.1').default || require('@embedded_assets/man/fish-lsp.1');
// } catch {
//   // Man file not embedded or not available
// }

type FindMatchPredicateFunction = (vf: VirtualFile) => boolean;
type FindMatchPredicate = string | FindMatchPredicateFunction;

class VirtualFile {
  private filetype: 'fish' | 'wasm' | 'json' | 'man' | 'unknown' = 'unknown';

  private constructor(
    // public realpath: string,
    public filepath: string,
    public content: string | Buffer,
  ) {
    this.filetype = filepath.endsWith('.fish') ? 'fish'
      : filepath.endsWith('.wasm') ? 'wasm'
        : filepath.endsWith('.json') ? 'json'
          : filepath.endsWith('.1') ? 'man'
            : 'unknown';

    if (this.filetype === 'wasm') {
      if (typeof this.content === 'string' && this.content.startsWith('data:application/wasm;base64,')) {
        this.content = Buffer.from(this.content.split(',')[1]!, 'base64');
      } else {
        this.content = '';
      }
    }
  }

  static create(
    filepath: string,
    content: string | Buffer,
  ) {
    return new VirtualFile(filepath, content);
  }

  get type() {
    return this.filetype;
  }

  exists(): boolean {
    return existsSync(this.filepath);
  }

  getParentDirectory(): string {
    if (this.filepath.includes('/')) {
      const dir = path.dirname(this.filepath).trim();
      if (dir === '.' || dir === '/') {
        return '';
      }
      return dir;
    }
    return '';
  }

  depth(): number {
    const dir = this.getParentDirectory();
    if (!dir) return 0;
    return dir.split('/').length;
  }

  basename(): string {
    return path.basename(this.filepath);
  }

  insideDirectory(dir: string): boolean {
    const parentDir = this.getParentDirectory();
    return parentDir === dir || parentDir.startsWith(dir + '/');
  }
}

export const VirtualFiles = [
  // Fish scripts
  VirtualFile.create('fish_files/exec.fish', execFishContent),
  VirtualFile.create('fish_files/expand_cartesian.fish', expandCartesianContent),
  VirtualFile.create('fish_files/get-autoloaded-filepath.fish', getAutoloadedFilepathContent),
  VirtualFile.create('fish_files/get-command-options.fish', getCommandOptionsContent),

  VirtualFile.create('fish_files/get-completion.fish', getCompletionContent),
  VirtualFile.create('fish_files/get-dependency.fish', getDependencyContent),
  VirtualFile.create('fish_files/get-documentation.fish', getDocumentationContent),
  VirtualFile.create('fish_files/get-fish-autoloaded-paths.fish', getFishAutoloadedPathsContent),
  VirtualFile.create('fish_files/get-type-verbose.fish', getTypeVerboseContent),
  VirtualFile.create('fish_files/get-type.fish', getTypeContent),
  // WASM
  VirtualFile.create('tree-sitter-fish.wasm', treeSitterFishWasmContent),
  VirtualFile.create('tree-sitter.wasm', treeSitterCoreWasmContent),
  // Man
  VirtualFile.create('man/fish-lsp.1', manPageContent),
  // Build info
  VirtualFile.create('out/build-time.json', JSON.stringify(buildTime)),
  // Package info
  VirtualFile.create('package.json', JSON.stringify(packageJson)),
].filter(vf => vf.content && vf.content.length > 0);

class VirtualFileSystem {
  private vol: Volume;
  private virtualMountPoint: string;
  private isInitialized: boolean = false;
  public allFiles: VirtualFile[] = [...VirtualFiles];
  public directories: string[] = [...new Set(VirtualFiles.filter(vf => vf.depth() > 0).map(vf => vf.getParentDirectory()))];

  constructor() {
    this.virtualMountPoint = join(tmpdir(), 'fish-lsp.virt');
    this.vol = new Volume();
    this.setupVirtualFS();
  }

  private setupVirtualFS() {
    const virtualFiles: Record<string, string | Buffer> = {};
    this.allFiles.forEach(virt => {
      virtualFiles[`/${virt.filepath}`] = virt.content;
    });

    // Initialize the volume with all files
    this.vol.fromJSON(virtualFiles, '/');
    this.isInitialized = true;
  }

  /**
   * Initialize the virtual filesystem by writing files to the virtual mount point
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create the virtual mount point directory
      await fs.promises.mkdir(this.virtualMountPoint, { recursive: true });

      // Write all virtual files to actual filesystem at mount point
      const writePromises: Promise<void>[] = [];

      // Write fish files
      const fishFilesDir = join(this.virtualMountPoint, 'fish_files');
      await fs.promises.mkdir(fishFilesDir, { recursive: true });

      if (this.vol.existsSync('/fish_files')) {
        const fishFiles = this.vol.readdirSync('/fish_files') as string[];
        for (const file of fishFiles) {
          const content = this.vol.readFileSync(`/fish_files/${file}`, 'utf8');
          writePromises.push(
            fs.promises.writeFile(join(fishFilesDir, file), content),
          );
        }
      }

      // Write WASM file if exists and is actually a file (not directory)
      if (this.vol.existsSync('/tree-sitter-fish.wasm')) {
        try {
          const stat = this.vol.statSync('/tree-sitter-fish.wasm');
          if (stat && stat.isFile && stat.isFile()) {
            const wasmContent = this.vol.readFileSync('/tree-sitter-fish.wasm');
            writePromises.push(
              fs.promises.writeFile(join(this.virtualMountPoint, 'tree-sitter-fish.wasm'), wasmContent),
            );
          }
        } catch (error) {
          console.warn('Failed to read WASM file from virtual filesystem:', error);
        }
      }

      // Write man file if exists
      if (this.vol.existsSync('/man/fish-lsp.1')) {
        const manDir = join(this.virtualMountPoint, 'man');
        await fs.promises.mkdir(manDir, { recursive: true });
        const manContent = this.vol.readFileSync('/man/fish-lsp.1', 'utf8');
        writePromises.push(
          fs.promises.writeFile(join(manDir, 'fish-lsp.1'), manContent),
        );
      }

      if (this.vol.existsSync('/out/build-time.json')) {
        const outDir = join(this.virtualMountPoint, 'out');
        await fs.promises.mkdir(outDir, { recursive: true });
        const buildTimeContent = this.vol.readFileSync('/out/build-time.json', 'utf8');
        writePromises.push(
          fs.promises.writeFile(join(outDir, 'build-time.json'), buildTimeContent),
        );
      }

      if (this.vol.existsSync('/package.json')) {
        const pkgContent = this.vol.readFileSync('/package.json', 'utf8');
        writePromises.push(
          fs.promises.writeFile(join(this.virtualMountPoint, 'package.json'), pkgContent),
        );
      }

      await Promise.all(writePromises);
      this.isInitialized = true;
    } catch (error) {
      console.warn('Failed to initialize virtual filesystem:', error);
    }
  }

  /**
   * Get the path to a file in the virtual mount point
   */
  getVirtualPath(relativePath: string): string {
    const found = this.allFiles.find(vf => vf.filepath.endsWith(relativePath));
    if (found) {
      return path.join(this.virtualMountPoint, found.filepath);
    }
    throw new Error(`File not found in virtual filesystem: ${relativePath}`);
  }

  /**
   * Get the virtual mount point directory
   */
  getMountPoint(): string {
    return this.virtualMountPoint;
  }

  // writeFile(relativePath: string, content: string): void {
  //   this.vol.writeFileSync(`/${relativePath}`, (content));
  // }

  /**
   * Check if virtual filesystem is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Display virtual filesystem structure like tree command
   */
  displayTree(): string {
    const lines: string[] = [];

    // Header
    lines.push('', '/tmp/fish-lsp.virt/');
    const fileCount = this.allFiles.length;
    const dirCount = this.directories.length;

    // Get directories and root files
    const sortedDirs = this.directories.filter(dir => dir && dir !== '/').sort();
    const filesAtRoot = this.allFiles.filter(vf => !vf.getParentDirectory() || vf.getParentDirectory() === '');

    // Create a combined list of directories and root files, sorted by name
    const allItems = [
      ...sortedDirs.map(dir => ({ type: 'dir', name: dir })),
      ...filesAtRoot.map(file => ({ type: 'file', name: file.basename(), file })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    // Display items in order
    allItems.forEach((item, index) => {
      const isLast = index === allItems.length - 1;
      const prefix = isLast ? '└── ' : '├── ';

      if (item.type === 'dir') {
        lines.push(`${prefix}${item.name}/`);

        // Add files in this directory
        const filesInDir = this.allFiles.filter(vf => vf.getParentDirectory() === item.name);
        filesInDir.forEach((vf, fileIndex) => {
          const isLastFile = fileIndex === filesInDir.length - 1;
          const filePrefix = isLast ?
            isLastFile ? '    └── ' : '    ├── ' :
            isLastFile ? '│   └── ' : '│   ├── ';
          lines.push(`${filePrefix}${vf.basename()}`);
        });
      } else {
        lines.push(`${prefix}${item.name}`);
      }
    });

    // Add summary
    lines.push('');
    if (dirCount > 0 && fileCount > 0) {
      lines.push(`${dirCount} directories, ${fileCount} files`);
    } else if (dirCount > 0) {
      lines.push(`${dirCount} directories`);
    } else if (fileCount > 0) {
      lines.push(`${fileCount} files`);
    }
    return lines.join('\n');
  }

  /**
   * Cleanup virtual filesystem
   */
  async cleanup(): Promise<void> {
    try {
      await fs.promises.rm(this.virtualMountPoint, { recursive: true, force: true });
      this.isInitialized = false;
    } catch (error) {
      console.warn('Failed to cleanup virtual filesystem:', error);
    }
  }

  find(predicate: FindMatchPredicate): VirtualFile | undefined {
    if (typeof predicate === 'string') {
      return this.allFiles.find(vf => vf.filepath.endsWith(predicate));
    }
    return this.allFiles.find(predicate);
  }

  get fishFiles() {
    return this.allFiles.filter(vf => vf.filepath.startsWith('fish_files/'))
      .map(vf => ({
        file: `/${vf.filepath}`,
        content: vf.content.toString(),
        exec: (...args: string[]) => {
          return execFileSync('fish', [vf.filepath, ...args])?.toString().trim() || '';
        },
        execAsync: async (...args: string[]) => {
          return await execAsync('fish', [vf.filepath, ...args]);
        },
      }));
  }

  /**
   * Get the best available path for a file - VFS path if bundled, or development paths
   */
  getPathOrFallback(vfsRelativePath: string, ...fallbackPaths: string[]): string {
    // Try VFS first (for bundled environment)
    try {
      const virtualPath = this.getVirtualPath(vfsRelativePath);
      if (existsSync(virtualPath)) {
        return virtualPath;
      }
    } catch {
      // VFS path not available
    }

    // Try fallback paths (for development environment)
    for (const path of fallbackPaths) {
      if (existsSync(path) && fs.statSync(path).isFile()) {
        return path;
      }
    }

    // Return first fallback as default
    return fallbackPaths[0] || vfsRelativePath;
  }
}

// Create singleton instance
export const vfs = new VirtualFileSystem();

// Auto-initialize when we detect we're in bundled mode
// (when fish_files directory doesn't exist or BUNDLED env var is set)
if (process.env.FISH_LSP_BUNDLED || !fs.existsSync(resolve(process.cwd(), 'fish_files'))) {
  // Initialize asynchronously but don't block module loading
  vfs.initialize().catch(error => {
    console.warn('Failed to initialize virtual filesystem:', error);
  });

  // Clean up on exit
  process.on('exit', () => {
    // Synchronous cleanup since we can't use async in exit handler
    try {
      fs.rmSync(vfs.getMountPoint(), { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors on exit
    }
  });
}

export default vfs;
