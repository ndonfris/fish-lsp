# Fish LSP Build Scripts

## Main Build System

The project uses a modern esbuild-based build system located in `scripts/build.ts`.

### Quick Commands

```bash
# Development builds
yarn build                    # Development build with source maps
yarn compile                  # Same as build (alias)
yarn watch                    # Watch mode for development

# Production builds  
yarn build:prod               # Production build (minified)
yarn build:binary             # Create bundled binary for npm
yarn build:binary:prod        # Production binary build
yarn build:web                # Create web bundle for browsers
yarn build:web:prod           # Production web bundle

# Legacy/specialized
yarn compile:types            # Generate TypeScript declarations only
yarn compile:legacy           # Use TypeScript compiler directly
```

### Direct Script Usage

```bash
# Run build script directly
tsx scripts/build.ts --binary
tsx scripts/build.ts --web --production
tsx scripts/build.ts --watch

# Or run the esbuild config directly
tsx scripts/esbuild/index.ts --binary
```

## Other Scripts

- **`build-binary.ts`** - Legacy Bun-based binary builder
- **`build-completions.fish`** - Generate Fish shell completions
- **`build-fish-wasm.fish`** - Build Fish WASM for web
- **`build-release.fish`** - Release preparation script
- **`build-time`** - Generate build timestamp
- **`fish-commands-scrapper.ts`** - Extract Fish command documentation

## ESBuild System

The esbuild configuration is modularized in `scripts/esbuild/`:

- **`index.ts`** - Main build entry point and configuration
- **`cli.ts`** - Command-line argument parsing
- **`configs.ts`** - Build target configurations
- **`plugins.ts`** - ESBuild plugin factories  
- **`utils.ts`** - Build utilities and helpers

See `scripts/esbuild/README.md` for detailed documentation.