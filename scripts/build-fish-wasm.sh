#!/usr/bin/env bash

yarn add web-tree-sitter
yarn add --dev tree-sitter-cli https://github.com/ram02z/tree-sitter-fish
npx tree-sitter build -w ./node_modules/tree-sitter-fish/ -o ./tree-sitter-fish.wasm

yarn remove tree-sitter-cli tree-sitter-fish