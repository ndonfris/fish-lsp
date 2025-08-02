// Improved CLI argument parsing
import { Command } from 'commander';

export interface BuildArgs {
  target: 'binary' | 'web' | 'library' | 'development' | 'all';
  watch: boolean;
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
    .option('-w, --watch', 'Watch for changes and rebuild', false)
    .option('-p, --production', 'Production build (minified, no sourcemaps)', false)
    .option('-m, --minify', 'Minify output', false)
    .option('--all', 'Build all targets: development, library, binary, and web', false)
    .option('--binary', 'Create bundled binary in build/', false)
    .option('--library', 'Create bundled library files for npm distribution', false)
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
  --watch, -w         Watch for changes and rebuild
  --binary            Create bundled binary in \`build/fish-lsp-bundled.js\` (used for publishing to npm)
  --web               Create web bundle with Node.js polyfills for browser usage
  --fish-wasm         Create web bundle with full Fish shell via WASM (large bundle, not yet supported)
  --enhanced          Use enhanced web build with Fish WASM
  --production, -p    Production build (minified, no sourcemaps)
  --minify, -m        Minify output
  --help, -h          Show this help message

Examples:
  tsx scripts/build.ts                       # Development build
  tsx scripts/build.ts --watch               # Watch mode  
  tsx scripts/build.ts --binary              # Create bundled binary
  tsx scripts/build.ts --web                 # Create web bundle
  tsx scripts/build.ts --production          # Production build
  
  # Or use yarn scripts:
  yarn build:binary                          # Create bundled binary
  yarn build:web                             # Create web bundle
  yarn watch                                 # Watch mode
`);
}
