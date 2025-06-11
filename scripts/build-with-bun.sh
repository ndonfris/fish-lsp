#!/usr/bin/env bash

set -euo pipefail

BUN_DIR="$(pwd)/.bun"
BUN_BIN="$BUN_DIR/bin/bun"

install_bun_locally() {
    echo "Installing Bun locally to $BUN_DIR..."
    
    # Create local bun directory
    mkdir -p "$BUN_DIR"
    
    # Download and install bun to local directory
    curl -fsSL https://bun.sh/install | BUN_INSTALL="$BUN_DIR" bash
    
    if [[ ! -f "$BUN_BIN" ]]; then
        echo "❌ Failed to install Bun locally"
        exit 1
    fi
    
    echo "✅ Bun installed locally at $BUN_BIN"
}

main() {
    # Check if local bun exists, install if not
    if [[ ! -f "$BUN_BIN" ]]; then
        install_bun_locally
    fi
    
    # Verify bun works
    echo "Using Bun version: $($BUN_BIN --version)"
    
    # Ensure TypeScript is compiled first
    echo "Compiling TypeScript..."
    yarn compile
    # yarn dev

    # echo "Ensuring all manfile is up to date..."
    # yarn generate:man
    
    # Run the build script with local bun
    echo "Building binaries..."
    "$BUN_BIN" run scripts/build-binary.ts
    
    echo "🎉 Build complete!"
}

main "$@"
