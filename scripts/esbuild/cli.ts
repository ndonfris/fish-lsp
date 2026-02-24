// Improved CLI argument parsing
import { Command } from 'commander';
import { BuildTarget, WatchMode, SourcemapMode, VALID_WATCH_MODES, VALID_SOURCEMAP_MODES } from './types';

export interface BuildArgs {
  target: BuildTarget;
  watch: boolean;
  watchAll: boolean;
  watchMode: WatchMode;
  production: boolean;
  minify: boolean;
  enhanced: boolean;
  fishWasm: boolean;
  typesOnly: boolean;
  sourcemaps: SourcemapMode;
  specialSourceMaps: boolean;
}

export function parseArgs(): BuildArgs {
  const program = new Command();
  
  program
    .name('dev-esbuild')
    .description('Fish LSP development build system using esbuild')
    .option('-w, --watch', 'Watch for changes to all relevant files and run full build', false)
    .option('--watch-all', 'Watch for changes to all relevant files and run full build (same as --watch)', false)
    .option('--mode <type>', 'Watch mode type: dev (default), lint, npm, types, binary, all, test', 'dev')
    .option('-p, --production', 'Production build (minified, optimized sourcemaps)', false)
    .option('-c, --completions', 'Show shell completions for this command', false)
    .option('-m, --minify', 'Minify output', true)
    .option('--sourcemaps <type>', 'Sourcemap type: optimized (default), extended (full debug), none, special (src-only)', 'optimized')
    .option('--special-source-maps', 'Enable special sourcemap processing (src files only with content)', false)
    .option('--all', 'Build all targets: development, binary, npm, and web', false)
    .option('--binary, --bin', 'Create bundled binary in build/', false)
    .option('--npm', 'Create NPM package build with external dependencies', false)
    .option('--web', 'Create web bundle with Node.js polyfills for browser usage', false)
    .option('--fish-wasm', 'Create web bundle with full Fish shell via WASM', false)
    .option('--enhanced', 'Use enhanced web build with Fish WASM', false)
    .option('--types', 'Generate TypeScript declaration files only', false)
    .option('--ci', 'Run CI/CD test on fresh install', false)
    .option('--fresh', 'fresh install', false)
    .option('--setup', 'setup & install dependencies without building', false)
    .option('-h, --help', 'Show help message');

  program.parse();
  const options = program.opts();

  // Check if any target flag was explicitly provided
  const hasTargetFlag = options.types || options.all || 
                        options.binary || options.bin || options.npm || options.library || 
                        options.test || options.web || options.fishWasm;

  // Determine target based on flags
  // Default to 'all' if no target flags are provided for backwards compatibility
  let target: BuildTarget = hasTargetFlag ? 'development' : 'all';
  if (options.types) target = 'types';
  else if (options.all) target = 'all';
  else if (options.binary || options.bin) target = 'binary';
  else if (options.npm) target = 'npm';
  else if (options.library) target = 'library';
  else if (options.test) target = 'test';
  else if (options.ci) target = 'ci';
  else if (options.fresh) target = 'fresh';
  else if (options.setup) target = 'setup';
  // else if (options.web || options.fishWasm) target = 'web';

  // Validate sourcemaps option
  let sourcemaps: SourcemapMode = (VALID_SOURCEMAP_MODES as readonly string[]).includes(options.sourcemaps)
    ? options.sourcemaps
    : 'optimized';
  
  // Override sourcemaps if special flag is used
  if (options.specialSourceMaps) {
    sourcemaps = 'special';
  }

  // Validate watchMode
  if (!(VALID_WATCH_MODES as readonly string[]).includes(options.mode)) {
    throw new Error(`Invalid watch mode: ${options.mode}. Must be one of: ${VALID_WATCH_MODES.join(', ')}`);
  }

  return {
    target,
    watch: options.watch,
    watchAll: options.watchAll,
    watchMode: options.mode as WatchMode,
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
  --watch, -w         Watch for changes to all relevant files and run full build
  --watch-all         Watch for changes to all relevant files and run full build (same as --watch)
  --mode <type>       Watch mode type: dev (default), lint, npm, types, binary, all, test
  --binary, --bin     Create bundled binary in bin/fish-lsp (used for GitHub releases)
  --npm               Create NPM package build with external dependencies (used for npm publishing)
  --web               Create web bundle with Node.js polyfills for browser usage
  --fish-wasm         Create web bundle with full Fish shell via WASM (large bundle, not yet supported)
  --enhanced          Use enhanced web build with Fish WASM
  --types             Generate TypeScript declaration files only
  --ci                Run CI/CD test on fresh install (installs from npm and runs test build)
  --fresh             Fresh install (installs from npm and runs test build, same as --ci)
  --setup             Setup & install dependencies without building (installs from npm and exits)
  --all               Build all targets: development, binary, npm
  --production, -p    Production build (minified, optimized sourcemaps)
  --minify, -m        Minify output
  --sourcemaps <type> Sourcemap type: optimized (default), extended (full debug), none, special (src-only)
  --special-source-maps Enable special sourcemap processing (src files only with content)
  --help, -h          Show this help message

Examples:
  tsx scripts/build.ts                       # Build all targets (default)
  tsx scripts/build.ts --watch               # Watch all files and run full build on changes
  tsx scripts/build.ts --watch-all           # Watch all files and run full build on changes (same as --watch)
  tsx scripts/build.ts --watch-all --mode=npm # Watch files and run npm build on changes
  tsx scripts/build.ts --watch-all --mode=types # Watch files and run types build on changes
  tsx scripts/build.ts --binary              # Create bundled binary
  tsx scripts/build.ts --bin                 # Create bundled binary (alias for --binary)
  tsx scripts/build.ts --npm                 # Create NPM package build
  tsx scripts/build.ts --types               # Generate TypeScript declaration files only
  tsx scripts/build.ts --all                 # Build all targets
  tsx scripts/build.ts --production          # Production build with optimized sourcemaps
  tsx scripts/build.ts --sourcemaps=extended # Development build with full debug sourcemaps
  tsx scripts/build.ts --sourcemaps=none     # Build without sourcemaps
  tsx scripts/build.ts --special-source-maps # Build with special sourcemaps (src files only)
  
  # Or use yarn scripts:
  yarn dev --binary                          # Create bundled binary
  yarn dev --npm                             # Create NPM package build
  yarn dev --types                           # Generate TypeScript declarations
  yarn dev --all                             # Build all targets
  yarn build:watch                           # Watch all files (equivalent to --watch-all)
  yarn build:watch --mode=npm                # Watch files and run npm build on changes
  yarn build:watch --mode=test               # Watch files and test build on changes
`);
}

export function showCompletions(): void {
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -f`)
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -s w -l watch -d "Watch for changes and rebuild (esbuild only)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l watch-all -d "Watch for changes to all relevant files and run full build"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l mode -d "Watch mode type" -x -a "dev lint npm types binary all test"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l all -d "Build all targets: development, binary, npm"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l binary -d "Create bundled binary in bin/fish-lsp"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l bin -d "Create bundled binary in bin/fish-lsp (alias for --binary)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l npm -d "Create NPM package build with external dependencies"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l web -d "Create web bundle with Node.js polyfills for browser usage"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l fish-wasm -d "Create web bundle with full Fish shell via WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l enhanced -d "Use enhanced web build with Fish WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l types -d "Generate TypeScript declaration files only"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l ci -d "Run CI/CD tests on fresh install"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l fresh -d "Reinstall with fresh dependencies"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l setup -d "Reinstall with fresh dependencies && build required dependencies (no build targets)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l production -d "Production build (minified, optimized sourcemaps)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l minify -d "Minify output"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -l special-source-maps -d "Enable special sourcemap processing (src files only with content)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -s h -l help -d "Show help message"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from dev" -s c -l completions -d "Show shell completions for this command"`);
}
