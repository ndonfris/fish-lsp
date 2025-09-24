// Improved CLI argument parsing
import { Command } from 'commander';
import { BuildTarget } from './types';

export interface BuildArgs {
  target: BuildTarget;
  watch: boolean;
  watchAll: boolean;
  watchMode: 'dev' | 'lint' | 'npm' | 'types' | 'binary' | 'all' | 'setup' | 'test';
  production: boolean;
  minify: boolean;
  enhanced: boolean;
  fishWasm: boolean;
  typesOnly: boolean;
  sourcemaps: 'optimized' | 'extended' | 'none' | 'special';
  specialSourceMaps: boolean;
}

export function parseArgs(): BuildArgs {
  const program = new Command();
  
  program
    .name('build-esbuild-dev')
    .description('Fish LSP build system using esbuild')
    .option('-w, --watch', 'Watch for changes and rebuild (esbuild only)', false)
    .option('--watch-all', 'Watch for changes to all relevant files and run full dev build', false)
    .option('--mode <type>', 'Watch mode type: dev (default), lint, npm, types, binary, all, setup', 'dev')
    .option('-p, --production', 'Production build (minified, optimized sourcemaps)', false)
    .option('-c, --completions', 'Show shell completions for this command', false)
    .option('-m, --minify', 'Minify output', true)
    .option('--sourcemaps <type>', 'Sourcemap type: optimized (default), extended (full debug), none, special (src-only)', 'optimized')
    .option('--special-source-maps', 'Enable special sourcemap processing (src files only with content)', false)
    .option('--all', 'Build all targets: development, binary, npm, and web', false)
    .option('--setup', 'Generate setup files: tests/setup-mocks.ts and src/types/embedded-assets.d.ts', false)
    .option('--binary', 'Create bundled binary in build/', false)
    .option('--npm', 'Create NPM package build with external dependencies', false)
    .option('--web', 'Create web bundle with Node.js polyfills for browser usage', false)
    .option('--fish-wasm', 'Create web bundle with full Fish shell via WASM', false)
    .option('--enhanced', 'Use enhanced web build with Fish WASM', false)
    .option('--types', 'Generate TypeScript declaration files only', false)
    .option('-h, --help', 'Show help message');

  program.parse();
  const options = program.opts();

  // Determine target based on flags
  let target: BuildTarget = 'development';
  if (options.setup) target = 'setup';
  else if (options.types) target = 'types';
  else if (options.all) target = 'all';
  else if (options.binary) target = 'binary';
  else if (options.npm) target = 'npm';
  else if (options.library) target = 'library';
  else if (options.test) target = 'test';
  // else if (options.web || options.fishWasm) target = 'web';

  // Validate sourcemaps option
  const validSourcemaps = ['optimized', 'extended', 'none', 'special'];
  let sourcemaps = validSourcemaps.includes(options.sourcemaps) 
    ? options.sourcemaps 
    : 'optimized';
  
  // Override sourcemaps if special flag is used
  if (options.specialSourceMaps) {
    sourcemaps = 'special';
  }

  // Validate watchMode
  const validWatchModes = ['dev', 'lint', 'npm', 'types', 'binary', 'all', 'setup', 'test'];
  if (!validWatchModes.includes(options.mode)) {
    throw new Error(`Invalid watch mode: ${options.mode}. Must be one of: ${validWatchModes.join(', ')}`);
  }

  return {
    target,
    watch: options.watch,
    watchAll: options.watchAll,
    watchMode: options.mode as 'dev' | 'lint' | 'npm' | 'types' | 'binary' | 'all' | 'setup' | 'test',
    production: options.production,
    minify: options.minify,
    enhanced: options.enhanced,
    fishWasm: options.fishWasm,
    typesOnly: options.types,
    sourcemaps,
    specialSourceMaps: options.specialSourceMaps,
  };
}

export function showHelp(): void {
  console.log(`
Usage: tsx scripts/build.ts [options]

Options:
  --watch, -w         Watch for changes and rebuild (esbuild only)
  --watch-all         Watch for changes to all relevant files and run full dev build
  --mode <type>       Watch mode type: dev (default), lint, npm, types, binary, all, setup
  --setup             Generate setup files: tests/setup-mocks.ts and src/types/embedded-assets.d.ts
  --binary            Create bundled binary in bin/fish-lsp (used for GitHub releases)
  --npm               Create NPM package build with external dependencies (used for npm publishing)
  --web               Create web bundle with Node.js polyfills for browser usage
  --fish-wasm         Create web bundle with full Fish shell via WASM (large bundle, not yet supported)
  --enhanced          Use enhanced web build with Fish WASM
  --types             Generate TypeScript declaration files only
  --all               Build all targets: development, binary, npm
  --production, -p    Production build (minified, optimized sourcemaps)
  --minify, -m        Minify output
  --sourcemaps <type> Sourcemap type: optimized (default), extended (full debug), none, special (src-only)
  --special-source-maps Enable special sourcemap processing (src files only with content)
  --help, -h          Show this help message

Examples:
  tsx scripts/build.ts                       # Development build
  tsx scripts/build.ts --watch               # Watch mode (esbuild only)
  tsx scripts/build.ts --watch-all           # Watch all files and run full dev build
  tsx scripts/build.ts --watch-all --mode=npm # Watch files and run npm build on changes
  tsx scripts/build.ts --watch-all --mode=types # Watch files and run types build on changes
  tsx scripts/build.ts --setup               # Generate setup files only
  tsx scripts/build.ts --binary              # Create bundled binary
  tsx scripts/build.ts --npm                 # Create NPM package build
  tsx scripts/build.ts --types               # Generate TypeScript declaration files only
  tsx scripts/build.ts --all                 # Build all targets
  tsx scripts/build.ts --production          # Production build with optimized sourcemaps
  tsx scripts/build.ts --sourcemaps=extended # Development build with full debug sourcemaps
  tsx scripts/build.ts --sourcemaps=none     # Build without sourcemaps
  tsx scripts/build.ts --special-source-maps # Build with special sourcemaps (src files only)
  
  # Or use yarn scripts:
  yarn build --setup                         # Generate setup files
  yarn build --binary                        # Create bundled binary
  yarn build --npm                           # Create NPM package build
  yarn build --types                         # Generate TypeScript declarations
  yarn build --all                           # Build all targets
  yarn dev:watch                             # Watch all files (equivalent to --watch-all)
  yarn dev:watch --mode=npm                  # Watch files and run npm build on changes
  yarn dev:watch --mode=test                 # Watch files and test build on changes
`);
}

export function showCompletions(): void {
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -f`)
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s w -l watch -d "Watch for changes and rebuild (esbuild only)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l watch-all -d "Watch for changes to all relevant files and run full dev build"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l mode -d "Watch mode type" -x -a "dev lint npm types binary all setup"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l setup -d "Generate setup files: tests/setup-mocks.ts and src/types/embedded-assets.d.ts"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l all -d "Build all targets: development, binary, npm"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l binary -d "Create bundled binary in bin/fish-lsp"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l npm -d "Create NPM package build with external dependencies"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l web -d "Create web bundle with Node.js polyfills for browser usage"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l fish-wasm -d "Create web bundle with full Fish shell via WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l enhanced -d "Use enhanced web build with Fish WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l types -d "Generate TypeScript declaration files only"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l production -d "Production build (minified, optimized sourcemaps)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l minify -d "Minify output"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l special-source-maps -d "Enable special sourcemap processing (src files only with content)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s h -l help -d "Show help message"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s c -l completions -d "Show shell completions for this command"`);
}
