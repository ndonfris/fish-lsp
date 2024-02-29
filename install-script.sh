#!/usr/bin/bash

# installs the wasm file to repo root directory 
# but causes error with *.wasm magic number
# $ curl -L https://github.com/esdmr/tree-sitter-fish/releases/tag/v3.5.1/tree-sitter-fish.wasm -o tree-sitter-fish.wasm

# installs the wasm file to repo root directory
pushd node_modules/tree-sitter-fish
npm install
tree-sitter build-wasm
cp tree-sitter-fish.wasm ../../tree-sitter-fish.wasm
popd