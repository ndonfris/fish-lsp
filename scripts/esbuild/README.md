# ESBuild Utilities

This folder contains all esbuild-related utilities for the fish-lsp build system.

## File Structure

- **`index.ts`** - **Main build entry point** with complete esbuild configuration
- **`cli.ts`** - Command-line argument parsing and help
- **`configs.ts`** - Build configuration objects for different targets
- **`plugins.ts`** - Plugin factories and configuration  
- **`utils.ts`** - Utility functions for file operations, stats, etc.

## Usage

### Direct execution:
```bash
# Run the build directly
tsx scripts/esbuild/index.ts --binary
tsx scripts/esbuild/index.ts --web --production
```

### Via wrapper script:
```bash
tsx scripts/build.ts --binary
```

### Via yarn scripts:
```bash
yarn build:binary:new    # Create bundled binary
yarn build:web:new       # Create web bundle  
yarn watch:new           # Watch mode
```

### Programmatic usage:
```typescript
import { build, buildConfigs, createBuildOptions } from './esbuild';

// Use the main build function
await build();

// Or configure manually
const config = buildConfigs.binary;
const buildOptions = createBuildOptions(config, true);
```

## Build Targets

- **`binary`** - Bundled Node.js binary with minimal polyfills
- **`web`** - Browser bundle with full polyfills
- **`development`** - Development build with source maps and type declarations

## Adding New Configurations

1. Add your configuration to `buildConfigs` in `configs.ts`
2. Add any new plugins to `plugins.ts`
3. Update the CLI options in `cli.ts` if needed
4. Export new utilities from `index.ts`