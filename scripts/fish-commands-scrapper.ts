/* eslint-disable no-console  */
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';

interface FishCommand {
  name: string;
  description: string;
}

// Check command line arguments
const args = process.argv.slice(2);

// Check if --help flag is provided
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

// Check if --write-to-snippets flag is provided
const shouldWriteToSnippets = args.includes('--write-to-snippets');

function printHelp() {
  console.log(`
Fish Commands Scraper
=====================

A tool that scrapes commands from the Fish shell documentation and outputs them in JSON format.

Usage:
  yarn tsx ./scripts/fish-commands-scraper.ts [options]
  
Options:
  --help, -h             Show this help message and exit
  --write-to-snippets    Write the output to ./src/snippets/helperCommands.json
                         (Note: the ./src/snippets directory must exist)

Examples:
  # Output to stdout
  yarn tsx scripts/fish-commands-scraper.ts
  
  # Save to a file
  yarn tsx scripts/fish-commands-scraper.ts > src/snippets/helperCommands.json
  
  # Write the output to the ./src/snippets/helperCommands.json file
  yarn tsx scripts/fish-commands-scraper.ts --write-to-snippets
  `);
}

async function fetchFishCommands(): Promise<FishCommand[]> {
  try {
    // Fetch the HTML content from the Fish shell documentation
    const response = await fetch('https://fishshell.com/docs/current/commands.html');
    const html = await response.text();

    // Parse the HTML using JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Find all list items that contain command references
    const commandItems = document.querySelectorAll('li.toctree-l1 a.reference.internal');

    const commands: FishCommand[] = [];

    // Process each command item
    commandItems.forEach((item) => {
      const linkText = item.textContent?.trim() || '';

      // Check if this is a command reference
      // Command references typically follow the pattern: "command - description"
      if (linkText.includes(' - ')) {
        const [name, description] = linkText.split(' - ', 2);

        commands.push({
          name: name.trim(),
          description: description.trim(),
        });
      }
    });

    return commands;
  } catch (error) {
    console.error('Error fetching Fish commands:', error);
    return [];
  }
}

async function main() {
  try {
    // Fetch the commands
    const commands = await fetchFishCommands();

    if (commands.length === 0) {
      console.error('No commands found. Check if the website structure has changed.');
      process.exit(1);
    }

    // Convert commands to JSON string
    const jsonOutput = JSON.stringify(commands, null, 2);

    // If --write-to-snippets flag is provided, write to file
    if (shouldWriteToSnippets) {
      // Check if the directory exists
      const snippetsDir = path.join(process.cwd(), 'src', 'snippets');

      try {
        // Check if directory exists by attempting to access it
        await fs.access(snippetsDir);
      } catch (error) {
        // Directory doesn't exist
        console.error(`Error: Directory '${snippetsDir}' does not exist.`);
        console.error('Please create the directory first before using --write-to-snippets option.');
        process.exit(1);
      }

      // Write to the specified file
      const outputPath = path.join(snippetsDir, 'helperCommands.json');
      await fs.writeFile(outputPath, jsonOutput);
      console.error(`Commands written to ${outputPath}`);
    } else {
      // Otherwise output to stdout
      process.stdout.write(jsonOutput + '\n');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
