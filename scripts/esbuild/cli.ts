// Improved CLI argument parsing
import { Command } from 'commander';

export interface BuildArgs {
  target: 'binary' | 'web' | 'development' | 'all';
  watch: boolean;
  watchAll: boolean;
  production: boolean;
  minify: boolean;
  enhanced: boolean;
  fishWasm: boolean;
}

export function parseArgs(): BuildArgs {
  const program = new Command();
  
  program
    .name('build-esbuild-dev')
    .description('Fish LSP build system using esbuild')
    .option('-w, --watch', 'Watch for changes and rebuild (esbuild only)', false)
    .option('--watch-all', 'Watch for changes to all relevant files and run full dev build', false)
    .option('-p, --production', 'Production build (minified, no sourcemaps)', false)
    .option('-c, --completions', 'Show shell completions for this command', false)
    .option('-m, --minify', 'Minify output', false)
    .option('--all', 'Build all targets: development, binary, and web', false)
    .option('--binary', 'Create bundled binary in build/', false)
    .option('--web', 'Create web bundle with Node.js polyfills for browser usage', false)
    .option('--fish-wasm', 'Create web bundle with full Fish shell via WASM', false)
    .option('--enhanced', 'Use enhanced web build with Fish WASM', false)
    .option('-h, --help', 'Show help message');

  program.parse();
  const options = program.opts();

  // Determine target based on flags
  let target: 'binary' | 'web' | 'library' | 'development' | 'all' = 'development';
  if (options.all) target = 'all';
  else if (options.binary) target = 'binary';
  else if (options.library) target = 'library';
  else if (options.web || options.fishWasm) target = 'web';

  return {
    target,
    watch: options.watch,
    watchAll: options.watchAll,
    production: options.production,
    minify: options.minify,
    enhanced: options.enhanced,
    fishWasm: options.fishWasm,
  };
}

export function showHelp(): void {
  console.log(`
Usage: tsx scripts/build.ts [options]

Options:
  --watch, -w         Watch for changes and rebuild (esbuild only)
  --watch-all         Watch for changes to all relevant files and run full dev build
  --binary            Create bundled binary in \`build/fish-lsp-bundled.js\` (used for publishing to npm)
  --web               Create web bundle with Node.js polyfills for browser usage
  --fish-wasm         Create web bundle with full Fish shell via WASM (large bundle, not yet supported)
  --enhanced          Use enhanced web build with Fish WASM
  --production, -p    Production build (minified, no sourcemaps)
  --minify, -m        Minify output
  --help, -h          Show this help message

Examples:
  tsx scripts/build.ts                       # Development build
  tsx scripts/build.ts --watch               # Watch mode (esbuild only)
  tsx scripts/build.ts --watch-all           # Watch all files and run full dev build
  tsx scripts/build.ts --binary              # Create bundled binary
  tsx scripts/build.ts --web                 # Create web bundle
  tsx scripts/build.ts --production          # Production build
  
  # Or use yarn scripts:
  yarn build:binary                          # Create bundled binary
  yarn build:web                             # Create web bundle
  yarn watch                                 # Watch mode
`);
}

export function showCompletions(): void {
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -f`)
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s w -l watch -d "Watch for changes and rebuild (esbuild only)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l watch-all -d "Watch for changes to all relevant files and run full dev build"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l all -d "Build all targets: development, binary, and web"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l binary -d "Create bundled binary in build/fish-lsp-bundled.js"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l web -d "Create web bundle with Node.js polyfills for browser usage"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l fish-wasm -d "Create web bundle with full Fish shell via WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l enhanced -d "Use enhanced web build with Fish WASM"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l production -d "Production build (minified,  no sourcemaps)"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -l minify -d "Minify output"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s h -l help -d "Show help message"`);
  console.log(`complete -c yarn -n "__fish_seen_subcommand_from build" -s c -l completions -d "Show shell completions for this command"`);
}
