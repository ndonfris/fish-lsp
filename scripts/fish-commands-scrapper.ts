/* eslint-disable no-console  */
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface FishCommand {
  name: string;
  description: string;
}

interface FishFunctionDefinition {
  name: string;
  file: string;
  flags?: string[];
  description?: string;
}

// Check command line arguments
const args = process.argv.slice(2);

// Check if --help flag is provided
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

// Check if --completions flag is provided
if (args.includes('--completions') || args.includes('-c')) {
  printCompletions();
  process.exit(0);
}

const datasetConfig = {
  commands: {
    outputFile: 'helperCommands.json',
  },
  functions: {
    outputFile: 'functions.json',
  },
  'special-variables': {
    outputFile: 'specialFishVariables.json',
  },
  'env-variables': {
    outputFile: 'envVariables.json',
  },
} as const;

type DatasetType = keyof typeof datasetConfig;

const writeOutput = args.includes('--write');
const diffOutput = args.includes('--diff') || args.includes('-d');

// Validate flag combinations
if (diffOutput && writeOutput) {
  console.error('Error: --diff and --write flags cannot be used together');
  process.exit(1);
}

const hasShowArg = args.some(arg => arg.startsWith('--show='));
const showArgsArray: DatasetType[] = args
  .filter(arg => arg.startsWith('--show='))
  .flatMap(arg => arg.split('=')[1]!.split(','))
  .map(entry => entry.trim())
  .filter((entry): entry is DatasetType => entry.length > 0 && entry in datasetConfig);

const showArgs: Record<keyof typeof datasetConfig, { seen: boolean }> = showArgsArray.reduce((acc, curr) => {
  acc[curr as keyof typeof datasetConfig].seen = true;
  return acc;
}, {
  commands: { seen: false },
  functions: { seen: false },
  'special-variables': { seen: false },
  'env-variables': { seen: false },
} as Record<keyof typeof datasetConfig, { seen: boolean }>);

function printHelp() {
  console.log(`
Fish Commands and Variables Scraper
===================================

A tool that scrapes commands and special variables from the Fish shell documentation
and outputs them in JSON format.

Usage:
  yarn tsx ./scripts/fish-commands-scraper.ts [options]

Options:
  -h, --help                  Show this help message and exit
  -c, --completions           Output Fish completions to stdout
  -d, --diff                  Show diff of new data vs existing snippets/*.json files
                              (Cannot be used with --write)
  --show=commands|special-variables|env-variables|functions
                              Output the requested data to stdout (default dataset is 'commands')
  --write                     Save the generated JSON to ./src/snippets/<dataset>.json
                              (Requires at least one --show flag; defaults to commands when omitted)

Examples:
  # Output commands to stdout (Default behavior)
  yarn tsx scripts/fish-commands-scraper.ts

  # Write commands to file
  yarn tsx scripts/fish-commands-scraper.ts --write --show=commands

  # Show diff before writing
  yarn tsx scripts/fish-commands-scraper.ts --diff --show=commands

  # Generate and save Fish completions to file
  yarn tsx scripts/fish-commands-scraper.ts --completions > ~/.config/fish/completions/fish-commands-scrapper.fish

  # Source completions dynamically in current shell (using psub for process substitution)
  source (yarn -s tsx scripts/fish-commands-scraper.ts --completions | psub)

  # Use with yarn run (--silent/-s flag suppresses yarn's output)
  source (yarn -s run generate:snippets --completions | psub)
  `);
}

function printCompletions() {
  const completionScript = `# Fish completion for fish-commands-scrapper
# This file can be saved to ~/.config/fish/completions/fish-commands-scrapper.fish
# Or sourced directly: source (yarn tsx scripts/fish-commands-scrapper.ts --completions | psub)

function __fish_fcs_show_state
    set -l token (commandline -ct)
    set -l prev (commandline -pt)

    if string match -q -- '--show=*' -- $token
        set token (string replace -r '^.*--show=' '' -- $token)
    else if test "$prev" = '--show'
        set token ''
    else
        return 1
    end

    set -l trailing_comma (string match -q -- ',$' "$token"; and echo 1)

    set -l entries
    set -l current ''

    if test -n "$token"
        if string match -q -- '*,*' "$token"
            # Has comma(s), split and process
            set entries (string split ',' -- $token)
            if test "$trailing_comma" = '1'
                set current ''
            else
                set current $entries[-1]
                set -e entries[-1]
            end
        else
            # No comma, entire token is the current partial entry
            set current $token
        end
    end

    set -l joined_entries (string join ',' $entries)
    printf '%s\\n%s\\n' "$joined_entries" "$current"
end

function __fish_fcs_show_candidates
    set -l state (__fish_fcs_show_state); or return 0

    set -l used
    if test -n "$state[1]"
        set used (string split ',' -- $state[1])
    end
    set -l current $state[2]

    # Build prefix for completions (the already-entered values)
    set -l prefix ''
    if test -n "$state[1]"
        set prefix "$state[1],"
    end

    set -l datasets commands special-variables env-variables functions
    for ds in $datasets
        if test -n "$used"
            if contains -- $ds $used
                continue
            end
        end
        if test -n "$current"
            if not string match -q -- "$current*" $ds
                continue
            end
        end
        # Output with prefix so it replaces the whole value
        echo "$prefix$ds"
    end
end

function __fish_fcs_in_show_context
    __fish_fcs_show_state >/dev/null
end

# Direct script completions
# Inline completion for --show=value,value,...
complete -c fish-commands-scrapper \\
    -n 'string match -q -- "--show=*" (commandline -ct)' \\
    -f \\
    -a '(__fish_fcs_show_candidates)' \\
    -d 'Dataset'

# --show flag (only if not already present)
complete -c fish-commands-scrapper \\
    -n 'not string match -q -- "*--show=*" (commandline -poc)' \\
    -l show -x \\
    -a '(__fish_fcs_show_candidates)' \\
    -d 'Dataset'

# --write flag (only if not already present and not --diff)
complete -c fish-commands-scrapper \\
    -n 'not string match -q -- "*--write*" (commandline -poc); and not string match -q -- "*--diff*" (commandline -poc)' \\
    -l write -f \\
    -d 'Write JSON to snippets/<dataset>.json'

# --diff flag (only if not already present and not --write)
complete -c fish-commands-scrapper \\
    -n 'not string match -q -- "*--diff*" (commandline -poc); and not string match -q -- "*--write*" (commandline -poc)' \\
    -s d -l diff -f \\
    -d 'Show diff vs existing files'

# --help flag
complete -c fish-commands-scrapper \\
    -s h -l help -f \\
    -d 'Show help message'

# --completions flag
complete -c fish-commands-scrapper \\
    -s c -l completions -f \\
    -d 'Output Fish completions'

# Disable file completions when --show is set and not typing a flag
complete -c fish-commands-scrapper \\
    -n 'string match -q -- "*--show=*" (commandline -poc); and not string match -q -- "--*" (commandline -ct)' \\
    -f

# yarn generate:snippets - Register the subcommand
complete -c yarn -f -n '__fish_use_subcommand' -a 'generate:snippets' -d 'Generate Fish snippets'

# Helper to complete --show values (inline completions after comma)
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and string match -q -- "--show=*" (commandline -ct)' \\
    -f \\
    -a '(__fish_fcs_show_candidates)' \\
    -d 'Dataset'

# Helper to provide --show flag completion (only if not already present)
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and not string match -q -- "*--show=*" (commandline -poc)' \\
    -l show -x \\
    -a '(__fish_fcs_show_candidates)' \\
    -d 'Dataset'

# --write flag (only if not already present and not --diff)
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and not string match -q -- "*--write*" (commandline -poc); and not string match -q -- "*--diff*" (commandline -poc)' \\
    -l write -f \\
    -d 'Write JSON to snippets/<dataset>.json'

# --diff flag (only if not already present and not --write)
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and not string match -q -- "*--diff*" (commandline -poc); and not string match -q -- "*--write*" (commandline -poc)' \\
    -s d -l diff -f \\
    -d 'Show diff vs existing files'

# --help flag
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets' \\
    -s h -l help -f \\
    -d 'Show help message'

# --completions flag
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets' \\
    -s c -l completions -f \\
    -d 'Output Fish completions'

# Disable file completions for generate:snippets when --show is set and we're not typing a flag
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and string match -q -- "*--show=*" (commandline -poc); and not string match -q -- "--*" (commandline -ct)' \\
    -f

# Provide long-form flags as completions when no prefix is typed
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets; and not string match -q -- "-*" (commandline -ct)' \\
    -f -k -a "
--show=\\t'dataset to show (commands, special-variables, env-variables, functions)'
--write\\t'write JSON to snippets/<dataset>.json'
-d\\t'show diff vs existing files'
--diff\\t'show diff vs existing files'
-c\\t'output Fish completions'
--completions\\t'output Fish completions'
-h\\t'show help message'
--help\\t'show help message'"

# Disable file completions for generate:snippets completely
complete -c yarn \\
    -n '__fish_seen_subcommand_from generate:snippets' \\
    -f
`;
  console.log(completionScript);
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

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tokenizeDefinition(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === '\\' && quote === '"' && i + 1 < line.length) {
        current += line[i + 1]!;
        i++;
        continue;
      }
      if (char === quote) {
        // Preserve quotes around the token
        tokens.push(`${quote}${current}${quote}`);
        current = '';
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === '\'') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens.filter(Boolean);
}

function parseFunctionLine(line: string): { name: string; flags: string[]; description?: string } | null {
  const match = line.match(/^\s*function\s+(.+)$/);
  if (!match) return null;
  const tokens = tokenizeDefinition(match[1]!.trim());
  if (tokens.length === 0) return null;
  const name = tokens.shift()!;
  const flags: string[] = [];
  let description: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith('-')) continue;

    // Collect all non-flag tokens following this flag
    const valueParts: string[] = [];
    let j = i + 1;
    while (j < tokens.length && !tokens[j]!.startsWith('-')) {
      valueParts.push(tokens[j]!);
      j++;
    }

    // Build combined flag string
    let combined = token;
    if (valueParts.length > 0) {
      combined = `${token} ${valueParts.join(' ')}`;
      if ((token === '--description' || token === '-d') && valueParts[0]) {
        description = stripQuotes(valueParts[0]);
      }
    }

    flags.push(combined.trim());

    // Skip the tokens we've already processed
    i = j - 1;
  }

  return { name, flags, description };
}

function resolveFishDataDir(): string | null {
  const candidateEnv = process.env.__fish_data_dir;
  const candidates = [
    candidateEnv,
    (() => {
      try {
        const result = execSync('fish -c "printf %s $__fish_data_dir"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return result.trim() || null;
      } catch {
        return null;
      }
    })(),
    '/usr/share/fish',
    '/usr/local/share/fish',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const functionsDir = path.join(candidate, 'functions');
    if (fsSync.existsSync(functionsDir)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extracts all complete function definitions from file contents,
 * handling multiline definitions with backslash continuations
 */
function extractFunctionDefinitions(fileContents: string): string[] {
  const lines = fileContents.split(/\r?\n/);
  const definitions: string[] = [];
  let definitionLine = '';
  let inDefinition = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!inDefinition && trimmed.startsWith('function ')) {
      inDefinition = true;
      definitionLine = trimmed;

      // Check if line ends with backslash (continuation)
      if (trimmed.endsWith('\\')) {
        definitionLine = trimmed.slice(0, -1).trim() + ' ';
        continue;
      } else {
        // Single-line definition
        definitions.push(definitionLine);
        definitionLine = '';
        inDefinition = false;
      }
    } else if (inDefinition) {
      // Continue collecting multiline definition
      if (trimmed.endsWith('\\')) {
        definitionLine += trimmed.slice(0, -1).trim() + ' ';
      } else {
        // End of multiline definition
        definitionLine += trimmed;
        definitions.push(definitionLine);
        definitionLine = '';
        inDefinition = false;
      }
    }
  }

  return definitions;
}

async function fetchFishFunctions(): Promise<FishFunctionDefinition[]> {
  const dataDir = resolveFishDataDir();
  if (!dataDir) {
    console.error('Unable to locate $__fish_data_dir. Is fish installed?');
    return [];
  }
  const functionsDir = path.join(dataDir, 'functions');
  const entries = await fs.readdir(functionsDir, { withFileTypes: true });
  const results = new Map<string, FishFunctionDefinition>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.fish')) continue;
    const filePath = path.join(functionsDir, entry.name);
    const fileContents = await fs.readFile(filePath, 'utf8');
    const definitionLines = extractFunctionDefinitions(fileContents);

    const relativeFunctionsPath = path.relative(path.join(dataDir, 'functions'), filePath).replace(/\\/g, '/');
    const fileReference = relativeFunctionsPath
      ? `$__fish_data_dir/functions/${relativeFunctionsPath}`
      : '$__fish_data_dir/functions';

    // Only process the FIRST function definition in the file
    // (subsequent functions are local helper functions, not globally defined)
    if (definitionLines.length > 0) {
      const definitionLine = definitionLines[0];
      const parsed = parseFunctionLine(definitionLine);
      if (parsed) {
        const def: FishFunctionDefinition = {
          name: parsed.name,
          file: fileReference,
        };

        // Only include flags if they exist
        if (parsed.flags.length > 0) {
          def.flags = parsed.flags;
        }

        // Only include description if it exists
        if (parsed.description) {
          def.description = parsed.description;
        }

        results.set(parsed.name, def);
      }
    }
  }

  return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchDataset(target: DatasetType): Promise<FishCommand[] | FishFunctionDefinition[]> {
  switch (target) {
    case 'commands':
      return fetchFishCommands();
    case 'functions':
      return fetchFishFunctions();
    case 'special-variables':
      return fetchSpecialVariables('special-variables');
    case 'env-variables':
      return fetchSpecialVariables('env-variables');
    default:
      return [];
  }
}

async function main() {
  try {
    const snippetsDir = path.join(process.cwd(), 'src', 'snippets');
    const requestedTargets: DatasetType[] = hasShowArg ? [...showArgsArray] as DatasetType[] : ['commands'];
    if (requestedTargets.length === 0) {
      requestedTargets.push('commands');
    }
    const uniqueTargets = [...new Set(requestedTargets)];

    if (uniqueTargets.length === 0) {
      console.error('No action specified. Use --help for usage.');
      return;
    }

    for (const target of uniqueTargets) {
      const dataset = await fetchDataset(target);
      if (!dataset || dataset.length === 0) {
        console.error(`No data found for "${target}".`);
        continue;
      }
      const jsonOutput = JSON.stringify(dataset, null, 2);

      // Handle --diff flag
      if (diffOutput) {
        const outputPath = path.join(snippetsDir, datasetConfig[target].outputFile);
        try {
          const existingContent = await fs.readFile(outputPath, 'utf8');
          const existingJson = JSON.parse(existingContent);
          const existingFormatted = JSON.stringify(existingJson, null, 2);

          if (existingFormatted === jsonOutput) {
            console.error(`No changes for ${target}`);
          } else {
            console.error(`\n=== Diff for ${target} (${outputPath}) ===`);
            const existingLines = existingFormatted.split('\n');
            const newLines = jsonOutput.split('\n');
            const maxLines = Math.max(existingLines.length, newLines.length);

            for (let i = 0; i < maxLines; i++) {
              const oldLine = existingLines[i] || '';
              const newLine = newLines[i] || '';
              if (oldLine !== newLine) {
                if (oldLine) console.error(`- ${oldLine}`);
                if (newLine) console.error(`+ ${newLine}`);
              }
            }
          }
        } catch (error) {
          console.error(`No existing file for ${target} at ${outputPath}`);
          console.error(`New content would be:\n${jsonOutput}`);
        }
        continue;
      }

      if (!writeOutput) {
        process.stdout.write(jsonOutput + '\n');
        continue;
      }

      try {
        await fs.access(snippetsDir);
      } catch (error) {
        console.error(`Error: Directory '${snippetsDir}' does not exist.`);
        console.error('Please create the directory first before using --write option.');
        process.exit(1);
      }

      const outputPath = path.join(snippetsDir, datasetConfig[target].outputFile);
      await fs.writeFile(outputPath, jsonOutput);
      console.error(`${target} data written to ${outputPath}`);
    }

  } catch (error) {
    console.error('General Error:', error);
    process.exit(1);
  }
}

main();
