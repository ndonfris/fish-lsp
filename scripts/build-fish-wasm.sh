#!/usr/bin/env fish

yarn add --dev @esdmr/tree-sitter-fish
set -l wasm_file "$(find node_modules/ -type f -a -name tree-sitter-fish.wasm)" 

if test -z "$wasm_file"
    echo "tree-sitter-fish.wasm not found"
    exit 1
end

cp $wasm_file ./tree-sitter-fish.wasm --force

yarn remove @esdmr/tree-sitter-fish

# npx tree-sitter build -w ./node_modules/tree-sitter-fish/ -o ./tree-sitter-fish.wasm
#
# yarn remove tree-sitter-cli tree-sitter-fish
