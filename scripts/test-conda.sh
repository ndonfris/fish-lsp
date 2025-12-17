#!/usr/bin/env bash

REL_VER="$(npm pkg get version | tr -d '"')"

echo "-----------------------------------"
echo "Executing \`./scripts/test-conda.sh\` script..."
echo "-----------------------------------"
echo "Current directory: $(pwd)"
echo "NPM version: $(npm -v)"
echo "Node version: $(node -v)"
echo "Releasing version: $REL_VER"
echo "-----------------------------------"
echo "Building and testing npm package..."

npm un -g fish-lsp || true
   # npm install -g -ddd --no-scripts --build-from-source ./fish-lsp-$version.tgz 
npm i --no-package-lock --ignore-scripts
npm run build:npm 
npm pack --pack-destination release-assets/npm/
npm i -g -ddd --build-from-source ./release-assets/npm/fish-lsp-$REL_VER.tgz 

echo "-----------------------------------"
echo "Running fish-lsp commands to verify installation..."

echo -e "HELP\n====\n$(fish-lsp --help)\n"
echo -e "VERSION\n=======\n$(fish-lsp --version)\n"
echo -e "INFO\n====\n$(fish-lsp info)\n"
echo -e "TIME-ONLY\n=========\n$(fish-lsp info --time-only)\n"
echo -e "CHECK-HEALTH\n============\n$(fish-lsp info --check-health)\n"
echo "-----------------------------------"
