#!/usr/bin/env tsx

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import fastGlob from 'fast-glob';
import chalk from 'chalk';

// Minimal types for CLI usage (no LSP dependencies)
interface TestFileSpec {
  relativePath: string;
  content: string | string[];
}

interface WorkspaceSnapshot {
  name: string;
  files: TestFileSpec[];
  timestamp: number;
}

class WorkspaceCLI {
  static fromSnapshot(snapshotPath: string): { name: string; files: TestFileSpec[] } {
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Snapshot file not found: ${snapshotPath}`);
    }

    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    const snapshot: WorkspaceSnapshot = JSON.parse(snapshotContent);
    
    return { name: snapshot.name, files: snapshot.files };
  }

  static convertSnapshotToWorkspace(snapshotPath: string, outputDir?: string): string {
    const snapshot = this.fromSnapshot(snapshotPath);
    const workspacePath = outputDir || path.join('tests/workspaces', snapshot.name);
    
    // Create workspace directory
    fs.mkdirSync(workspacePath, { recursive: true });
    
    // Create fish directory structure
    const fishDirs = new Set<string>();
    snapshot.files.forEach(file => {
      const dir = path.dirname(file.relativePath);
      if (dir !== '.') fishDirs.add(dir);
    });
    
    fishDirs.forEach(dir => {
      const dirPath = path.join(workspacePath, dir);
      fs.mkdirSync(dirPath, { recursive: true });
    });
    
    // Write files
    snapshot.files.forEach(file => {
      const filePath = path.join(workspacePath, file.relativePath);
      const content = Array.isArray(file.content) ? file.content.join('\n') : file.content;
      fs.writeFileSync(filePath, content, 'utf8');
    });
    
    return workspacePath;
  }

  static readWorkspace(folderPath: string): { path: string; files: string[] } {
    const absPath = path.isAbsolute(folderPath) 
      ? folderPath 
      : fs.existsSync(path.join('tests/workspaces', folderPath))
        ? path.resolve(path.join('tests/workspaces', folderPath))
        : path.resolve(folderPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Workspace directory not found: ${absPath}`);
    }

    // Check if there's a fish subdirectory
    let searchPath = absPath;
    if (fs.existsSync(path.join(absPath, 'fish')) && fs.statSync(path.join(absPath, 'fish')).isDirectory()) {
      searchPath = path.join(absPath, 'fish');
    }

    const files = fastGlob.sync(['**/*.fish'], { cwd: searchPath });
    return { path: absPath, files };
  }

  static convertWorkspaceToSnapshot(folderPath: string, outputPath?: string): string {
    const workspace = this.readWorkspace(folderPath);
    
    // Check if there's a fish subdirectory
    let searchPath = workspace.path;
    if (fs.existsSync(path.join(workspace.path, 'fish'))) {
      searchPath = path.join(workspace.path, 'fish');
    }
    
    const files: TestFileSpec[] = [];
    workspace.files.forEach(relPath => {
      const fullPath = path.join(searchPath, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      files.push({ relativePath: relPath, content });
    });
    
    const snapshot: WorkspaceSnapshot = {
      name: path.basename(workspace.path),
      files,
      timestamp: Date.now()
    };
    
    const snapshotPath = outputPath || path.join(path.dirname(workspace.path), `${snapshot.name}.snapshot`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    
    return snapshotPath;
  }

  static showFileTree(dirPath: string): string {
    if (!fs.existsSync(dirPath)) {
      return 'Directory not found';
    }

    const tree: string[] = [];
    const buildTree = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach((entry, index) => {
        const isLast = index === entries.length - 1;
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
        tree.push(currentPrefix + entry.name);

        if (entry.isDirectory()) {
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          buildTree(path.join(dir, entry.name), nextPrefix);
        }
      });
    };

    tree.push(path.basename(dirPath) + '/');
    buildTree(dirPath, '');
    return tree.join('\n');
  }

  static async showTreeSitterAST(folderPath: string, useColors: boolean = true): Promise<void> {
    const workspace = this.readWorkspace(folderPath);
    let searchPath = workspace.path;
    if (fs.existsSync(path.join(workspace.path, 'fish'))) {
      searchPath = path.join(workspace.path, 'fish');
    }

    for (let idx = 0; idx < workspace.files.length; idx++) {
      const relPath = workspace.files[idx];
      const fullPath = path.join(searchPath, relPath);
      
      try {
        // Use child_process to call fish-lsp info --dump-parse-tree
        const colorFlag = useColors ? '' : '--no-color';
        const cmd = `fish-lsp info --dump-parse-tree ${colorFlag} "${fullPath}"`;
        
        const result = child_process.execSync(cmd, { 
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        if (idx > 0) console.log(chalk.white('---------------------------------------------'));
        console.log('file:', chalk.green(`${relPath}`));
        console.log();
        console.log(result);
        if (idx < workspace.files.length - 1) {
          console.log();
        }
      } catch (error) {
        console.error(`❌ Error parsing ${relPath}:`, error.message);
        if (error.stderr) {
          console.error(`stderr: ${error.stderr}`);
        }
      }
    }
  }

}

// Generate fish shell completions for yarn sh:workspace-cli
function generateFishCompletions(): void {
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -f`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -s h -l help -d "Show help"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -s V -l version -d "Show version"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -s c -l completions -d "Generate fish completions"`);

  // read command
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "not __fish_seen_subcommand_from read snapshot-to-workspace workspace-to-snapshot show help" -a "read" -d "Read and display workspace from directory"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from read" -l show-tree -d "Show file tree"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from read" -F`);

  // snapshot-to-workspace command
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "not __fish_seen_subcommand_from read snapshot-to-workspace workspace-to-snapshot show help" -a "snapshot-to-workspace" -d "Convert snapshot file to workspace directory"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from snapshot-to-workspace" -s o -l output -d "Output directory" -F`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from snapshot-to-workspace" -k -xa "(find . -name '*.snapshot' -type f 2>/dev/null)"`);

  // workspace-to-snapshot command
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "not __fish_seen_subcommand_from read snapshot-to-workspace workspace-to-snapshot show help" -a "workspace-to-snapshot" -d "Convert workspace directory to snapshot file"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from workspace-to-snapshot" -s o -l output -d "Output snapshot file path" -F`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from workspace-to-snapshot" -F`);

  // show command
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "not __fish_seen_subcommand_from read snapshot-to-workspace workspace-to-snapshot show help" -a "show" -d "Display snapshot or workspace contents"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from show" -l show-tree -d "Show file tree (for workspaces)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from show" -l show-tree-sitter-ast -d "Show Tree-sitter AST for each fish file (for workspaces)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from show" -l no-color -d "Disable color output for Tree-sitter AST"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from show" -F`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from show" -k -xa "(find . -name '*.snapshot' -type f 2>/dev/null)"`);

  // help command
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "not __fish_seen_subcommand_from read snapshot-to-workspace workspace-to-snapshot show help" -a "help" -d "Display help for command"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from sh:workspace-cli" -n "__fish_seen_subcommand_from help" -xa "read snapshot-to-workspace workspace-to-snapshot show"`);
}

// CLI setup
const program = new Command()
  .name('workspace-cli')
  .description('Test workspace utilities - convert between snapshots and folders')
  .version('1.0.0')
  .option('-c, --completions', 'Generate fish shell completions');

program
  .command('read')
  .description('Read and display workspace from directory')
  .argument('<path>', 'Path to workspace directory')
  .option('--show-tree', 'Show file tree')
  .action((workspacePath, options) => {
    try {
      const workspace = WorkspaceCLI.readWorkspace(workspacePath);
      console.log(`📁 Workspace: ${workspace.path}`);
      console.log(`📄 Found ${workspace.files.length} fish files`);
      
      workspace.files.forEach(file => {
        console.log(`   ${file}`);
      });
      
      if (options.showTree) {
        console.log('\n🌳 File tree:');
        console.log(WorkspaceCLI.showFileTree(workspace.path));
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('snapshot-to-workspace')
  .description('Convert snapshot file to workspace directory')
  .argument('<snapshot>', 'Path to snapshot file')
  .option('-o, --output <path>', 'Output directory')
  .action((snapshotPath, options) => {
    try {
      const workspacePath = WorkspaceCLI.convertSnapshotToWorkspace(snapshotPath, options.output);
      console.log(`✅ Converted snapshot to workspace:`);
      console.log(`   📁 ${workspacePath}`);
      
      const workspace = WorkspaceCLI.readWorkspace(workspacePath);
      console.log(`   📄 ${workspace.files.length} files created`);
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('workspace-to-snapshot')
  .description('Convert workspace directory to snapshot file')
  .argument('<workspace>', 'Path to workspace directory')
  .option('-o, --output <path>', 'Output snapshot file path')
  .action((workspacePath, options) => {
    try {
      const snapshotPath = WorkspaceCLI.convertWorkspaceToSnapshot(workspacePath, options.output);
      console.log(`✅ Converted workspace to snapshot:`);
      console.log(`   📄 ${snapshotPath}`);
      
      const snapshot = WorkspaceCLI.fromSnapshot(snapshotPath);
      console.log(`   📁 ${snapshot.files.length} files archived`);
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('show')
  .description('Display snapshot or workspace contents')
  .argument('<path>', 'Path to snapshot file or workspace directory')
  .option('--show-tree', 'Show file tree (for workspaces)')
  .option('--show-tree-sitter-ast', 'Show Tree-sitter AST for each fish file (for workspaces)')
  .option('--no-color', 'Disable color output for Tree-sitter AST')
  .action(async (inputPath, options) => {
    try {
      if (inputPath.endsWith('.snapshot')) {
        const snapshot = WorkspaceCLI.fromSnapshot(inputPath);
        console.log(`📷 Snapshot: ${snapshot.name}`);
        console.log(`📄 Files: ${snapshot.files.length}`);
        
        snapshot.files.forEach(file => {
          console.log(`   ${file.relativePath}`);
        });
      } else {
        const workspace = WorkspaceCLI.readWorkspace(inputPath);
        console.log(`📁 Workspace: ${workspace.path}`);
        console.log(`📄 Files: ${workspace.files.length}`);
        
        workspace.files.forEach(file => {
          console.log(`   ${file}`);
        });
        
        if (options.showTree) {
          console.log('\n🌳 File tree:');
          console.log(WorkspaceCLI.showFileTree(workspace.path));
        }
        
        if (options.showTreeSitterAst) {
          console.log('\n🌳 Tree-sitter AST:');
          const useColors = !options.noColor;
          await WorkspaceCLI.showTreeSitterAST(inputPath, useColors);
        }
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

if (require.main === module) {
  // Handle help and completions like the build script
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    program.outputHelp();
    process.exit(0);
  }
  
  if (process.argv.includes('--completions') || process.argv.includes('-c')) {
    generateFishCompletions();
    process.exit(0);
  }
  
  program.parse();
}
