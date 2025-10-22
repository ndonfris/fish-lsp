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

// Check if --write-to-snippets flag is provided (Original command scraper flag)
const writeToFile = args.includes('--write-to-snippets');
// New flag for special variables scraper
const writeSpecialVariablesToFile = args.includes('--write-special-variables');
// Default behavior is to output commands to stdout if no write flag is present
const outputCommandsToStdout = !(writeToFile || writeSpecialVariablesToFile);

const hasShowArg = args.some(arg => arg.startsWith('--show='));
const showArgsArray: ('commands' | 'special-variables' | 'env-variables')[] = args.filter(arg => arg.startsWith('--show='))
  .map(arg => arg.split('=')[1]).flat() as ('commands' | 'special-variables' | 'env-variables')[];

const showArgs = {
  commands: {
    seen: hasShowArg ? showArgsArray.includes('commands') : outputCommandsToStdout,
    outputFile: 'commands.json',
    url: 'https://fishshell.com/docs/current/commands.html',
  },
  'special-variables': {
    seen: hasShowArg ? showArgsArray.includes('special-variables') : false,
    outputFile: 'specialFishVariables.json',
    url: 'https://fishshell.com/docs/current/language.html',
  },
  'env-variables': {
    seen: hasShowArg ? showArgsArray.includes('env-variables') : false,
    outputFile: 'envVariables.json',
    url: 'https://fishshell.com/docs/current/language.html#environment-variables',
  }
} as const;

function printHelp() {
  console.log(`
Fish Commands and Variables Scraper
===================================

A tool that scrapes commands and special variables from the Fish shell documentation
and outputs them in JSON format.

Usage:
  yarn tsx ./scripts/fish-commands-scraper.ts [options]
  
Options:
  --help, -h                  Show this help message and exit
  --write-to-snippets         Write the scraped commands to ./src/snippets/helperCommands.json
                              (Note: This is the old flag name and is equivalent to --write-commands if we had one)
  --show=commands|special-variables|env-variables               
                              Output the scraped commands to stdout (Default behavior)
  --write-special-variables   Write the scraped special variables to ./src/snippets/specialFishVariables.json
                              (Note: the ./src/snippets directory must exist)

Examples:
  # Output commands to stdout (Default behavior)
  yarn tsx scripts/fish-commands-scraper.ts
  
  # Write commands to file
  yarn tsx scripts/fish-commands-scraper.ts --write-to-snippets
  
  # Write special variables to file
  yarn tsx scripts/fish-commands-scraper.ts --write-special-variables
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

async function fetchSpecialVariables(...keys: ('special-variables' | 'env-variables')[]): Promise<FishCommand[]> {
  try {
    // Fetch the HTML content for language documentation
    const url = 'https://fishshell.com/docs/current/language.html';
    const response = await fetch(url);
    const html = await response.text();

    // Parse the HTML using JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const specialVariables: FishCommand[] = [];

    // Find the element with the 'special-variables' ID (usually an anchor or heading)
    const headingWithId = document.querySelector('#special-variables');
    // Find the section container that holds the variable list
    const specialVariablesSection = headingWithId?.closest('section');

    if (!specialVariablesSection) {
      console.error(`Could not find the section for special variables on ${url}`);
      return [];
    }

    // Special variables are typically documented as a Definition List (<dl>)
    // with <dt> for the variable name and <dd> for the description.
    const definitionTerms = specialVariablesSection.querySelectorAll('section#special-variables>dl');

    definitionTerms.forEach((dt) => {
      // `section#special-variables>dl dt > span` is the name key
      // dl.std:nth-child(12) > dd:nth-child(2) > p:nth-child(1)
      // console.log(dt.querySelector('dt>span')?.textContent);
      // console.log(dt.querySelector('dd>p')?.textContent.toString());



      const label = dt.querySelector('dt>span')?.textContent?.trim() || '';
      const desc = dt.querySelector('dd>p')?.textContent?.trim() || '';

      if (label.includes(' and ')) {
        label.split(' and ').forEach((part) => {
          specialVariables.push({
            name: part.trim(),
            description: desc,
          });
        })
        return;
      }

      specialVariables.push({
        name: label,
        description: desc,
      });
    })


    // The variable name is usually in a <code> tag inside <dt>
    //   const variableCodeElement = dt.querySelector('code');
    //   const nameWithDollar = variableCodeElement?.textContent?.trim() || '';
    //
    //   // Clean up the name (remove leading '$')
    //   const name = nameWithDollar.startsWith('$') ? nameWithDollar.substring(1) : nameWithDollar;
    //
    //   // The description is in the immediately following <dd> sibling
    //   const dd = dt.nextElementSibling;
    //   let description = '';
    //
    //   if (dd && dd.tagName === 'DD') {
    //     // Get the full text content of <dd> and normalize whitespace
    //     description = dd.textContent?.trim().replace(/\s+/g, ' ') || '';
    //   }
    //
    //   if (name && description) {
    //     specialVariables.push({
    //       name: name,
    //       description: description,
    //     });
    //   }
    // });

    const sectionLabelSeparator = specialVariables.findIndex(item => item.name === '_');
    if (showArgs['env-variables'].seen && showArgs['special-variables'].seen && keys.length === 2) {
      return specialVariables;
    }
    if (showArgs['env-variables'].seen && keys.length === 1) {
      return specialVariables.slice(sectionLabelSeparator);
    }
    if (showArgs['special-variables'].seen && keys.length === 1) {
      return specialVariables.slice(0, sectionLabelSeparator);
    }
  } catch (error) {
    console.error('Error fetching special variables:', error);
    return [];
  }
}

async function main() {
  try {
    const snippetsDir = path.join(process.cwd(), 'src', 'snippets');
    let hasRun = false;

    if (hasShowArg) {
      for (const key of Object.keys(showArgs) as (keyof typeof showArgs)[]) {
        if (showArgs[key].seen && ['special-variables', 'env-variables'].includes(key)) {
          const specialVariables = await fetchSpecialVariables(key as 'special-variables' | 'env-variables');
          const jsonOutput = JSON.stringify(specialVariables, null, 2);
          if (writeToFile) {
            const outputPath = path.join(snippetsDir, showArgs[key].outputFile);
            await fs.writeFile(outputPath, jsonOutput);
          } else {
            process.stdout.write(jsonOutput + '\n');
          }
        }
      }
      return;
    }

    // --- Special Variables Scraper/Writer ---
    if (writeSpecialVariablesToFile) {
      hasRun = true;
      const specialVariables = await fetchSpecialVariables();

      if (specialVariables.length === 0) {
        console.error('No special variables found. Check if the website structure has changed.');
      } else {
        const jsonOutput = JSON.stringify(specialVariables, null, 2);

        try {
          await fs.access(snippetsDir);
        } catch (error) {
          console.error(`Error: Directory '${snippetsDir}' does not exist.`);
          console.error('Please create the directory first before using --write-special-variables option.');
          process.exit(1);
        }

        const outputPath = path.join(snippetsDir, 'specialFishVariables.json');
        await fs.writeFile(outputPath, jsonOutput);
        console.error(`Special variables written to ${outputPath}`);
      }
    }

    // --- Commands Scraper/Writer (Handles original --write-to-snippets and default stdout) ---
    if (writeToFile || outputCommandsToStdout) {
      hasRun = true;
      const commands = await fetchFishCommands();

      if (commands.length === 0) {
        console.error('No commands found. Check if the website structure has changed.');
        if (outputCommandsToStdout) {
          process.exit(1);
        }
      } else {
        const jsonOutput = JSON.stringify(commands, null, 2);

        if (writeToFile) {
          try {
            await fs.access(snippetsDir);
          } catch (error) {
            console.error(`Error: Directory '${snippetsDir}' does not exist.`);
            console.error('Please create the directory first before using --write-to-snippets option.');
            process.exit(1);
          }

          // Write to the specified file
          const outputPath = path.join(snippetsDir, 'helperCommands.json');
          await fs.writeFile(outputPath, jsonOutput);
          console.error(`Commands written to ${outputPath}`);
        } else if (outputCommandsToStdout) {
          // Otherwise output to stdout (only if no other file-write flags were used)
          process.stdout.write(jsonOutput + '\n');
        }
      }
    }

    // If no scraper ran (e.g., only --help was called, which exits before main), that's fine.
    // Otherwise, if no output was produced, we can exit cleanly.
    if (!hasRun) {
      console.error('No action specified. Use --help for usage.');
    }

  } catch (error) {
    console.error('General Error:', error);
    process.exit(1);
  }
}

main();
