#!/usr/bin/env tsx

/**
 * Script to update markdown code blocks based on special HTML comments
 *
 * This script searches for HTML comments in the format:
 *   <!-- FISH_LSP_UPDATE_CODEBLOCK: command args -->
 *   ```language
 *   old content
 *   ```
 *
 * For each comment found, it:
 * 1. Extracts the command after the colon
 * 2. Executes the command in fish shell
 * 3. Replaces only the code block content (preserving the ```language markers)
 *
 * Usage:
 *   tsx scripts/update-codeblocks-in-docs.ts [--dry-run] [path]
 *
 * Options:
 *   --dry-run    Show what would be changed without modifying files
 *   path         Absolute path to a file or directory to process (optional)
 *                If not provided, searches all markdown files in the workspace
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fg from 'fast-glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKSPACE_ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// Get custom path from args (filter out script name, node, tsx, and flags)
const args = process.argv.slice(2).filter(arg => !arg.includes('--') && !arg.includes('node_modules') && !arg.endsWith('.ts'));
const customPath = args.length > 0 ? resolve(args[0]) : undefined;

interface UpdateDirective {
  lineNumber: number;
  command: string;
}

function extractUpdateDirectives(content: string): UpdateDirective[] {
  const lines = content.split('\n');
  const directives: UpdateDirective[] = [];
  const pattern = /<!-- FISH_LSP_UPDATE_CODEBLOCK: (.+) -->/;

  lines.forEach((line, index) => {
    const match = line.match(pattern);
    if (match && match[1]) {
      directives.push({
        lineNumber: index,
        command: match[1].trim(),
      });
    }
  });

  return directives;
}

function executeCommand(command: string): { output: string; status: number } {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      shell: '/usr/bin/fish',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { output: output.trimEnd(), status: 0 };
  } catch (error: any) {
    return {
      output: error.stdout?.toString() || error.stderr?.toString() || '',
      status: error.status || 1,
    };
  }
}

function processReadme(content: string, filePath: string): { newContent: string; updatesCount: number } {
  const lines = content.split('\n');
  const directives = extractUpdateDirectives(content);
  
  if (directives.length === 0) {
    return { newContent: content, updatesCount: 0 };
  }

  let updatesCount = 0;
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if current line has an update directive
    const directive = directives.find(d => d.lineNumber === i);

    if (directive) {
      console.error(`  ✓ Line ${i + 1}: ${directive.command}`);

      // Add the comment line
      output.push(line);
      i++;

      // Find the opening backticks
      while (i < lines.length) {
        const currentLine = lines[i];
        
        if (currentLine.match(/^```/)) {
          // Found opening backticks - preserve them
          const codeblockOpening = currentLine;
          output.push(codeblockOpening);
          i++;

          // Execute command
          console.error(`    Executing: ${directive.command}`);
          const { output: commandOutput, status } = executeCommand(directive.command);
          
          if (status !== 0) {
            console.error(`    ❌ Error: Command exited with status ${status} - skipping update`);
            
            // Command failed - keep old content
            while (i < lines.length) {
              const contentLine = lines[i];
              output.push(contentLine);
              
              if (contentLine.match(/^```/)) {
                // Found closing backticks
                i++;
                break;
              }
              
              i++;
            }
            break;
          }

          // Add new content (command succeeded)
          output.push(commandOutput);

          // Skip old content until closing backticks
          while (i < lines.length) {
            const contentLine = lines[i];
            
            if (contentLine.match(/^```/)) {
              // Found closing backticks
              output.push(contentLine);
              i++;
              break;
            }
            
            // Skip old content line
            i++;
          }

          updatesCount++;
          break;
        }
        
        // Line between comment and codeblock
        output.push(currentLine);
        i++;
      }
    } else {
      // Regular line
      output.push(line);
      i++;
    }
  }

  return { newContent: output.join('\n'), updatesCount };
}

function getMarkdownFiles(targetPath?: string): string[] {
  if (targetPath) {
    // Check if path exists
    if (!existsSync(targetPath)) {
      console.error(`Error: Path does not exist: ${targetPath}`);
      process.exit(1);
    }

    const stats = statSync(targetPath);
    
    if (stats.isFile()) {
      // Single file - verify it's a markdown file
      if (!targetPath.endsWith('.md')) {
        console.error(`Error: File is not a markdown file: ${targetPath}`);
        process.exit(1);
      }
      return [targetPath];
    } else if (stats.isDirectory()) {
      // Directory - find all markdown files
      return fg.sync('**/*.md', {
        cwd: targetPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
    }
  }

  // No path provided - search workspace
  return fg.sync('**/*.md', {
    cwd: WORKSPACE_ROOT,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  });
}

function processFile(filePath: string): { updated: boolean; updatesCount: number } {
  const content = readFileSync(filePath, 'utf-8');
  const directives = extractUpdateDirectives(content);

  if (directives.length === 0) {
    return { updated: false, updatesCount: 0 };
  }

  console.log(`\n📄 Processing: ${filePath}`);
  console.log(`   Found ${directives.length} directive(s)\n`);

  const { newContent, updatesCount } = processReadme(content, filePath);

  if (!DRY_RUN && updatesCount > 0) {
    writeFileSync(filePath, newContent, 'utf-8');
  }

  return { updated: updatesCount > 0, updatesCount };
}

function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be modified\n');
  }

  console.log('Scanning for markdown files with FISH_LSP_UPDATE_CODEBLOCK directives...\n');

  // Get markdown files to process
  const markdownFiles = getMarkdownFiles(customPath);

  if (markdownFiles.length === 0) {
    console.log('No markdown files found.');
    process.exit(0);
  }

  console.log(`Found ${markdownFiles.length} markdown file(s) to scan\n`);

  // Process each file
  let totalDirectives = 0;
  let totalUpdates = 0;
  let filesUpdated = 0;

  for (const filePath of markdownFiles) {
    const { updated, updatesCount } = processFile(filePath);
    
    if (updated) {
      filesUpdated++;
      totalUpdates += updatesCount;
    }

    // Count directives in file
    const content = readFileSync(filePath, 'utf-8');
    const directives = extractUpdateDirectives(content);
    totalDirectives += directives.length;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (DRY_RUN) {
    console.log('🔍 DRY RUN COMPLETE - No changes were made');
    console.log(`   Scanned ${markdownFiles.length} file(s)`);
    console.log(`   Found ${totalDirectives} directive(s) in ${filesUpdated} file(s)`);
    console.log(`   Would update ${totalUpdates} codeblock(s)`);
  } else {
    console.log('✨ Processing complete!');
    console.log(`   Scanned ${markdownFiles.length} file(s)`);
    console.log(`   Found ${totalDirectives} directive(s) in ${filesUpdated} file(s)`);
    console.log(`   Updated ${totalUpdates} codeblock(s)`);
  }
}

main();
