#!/usrs/local/bin/env fish

set -l wasm_file "$(find node_modules/ -type f -a -name tree-sitter-fish.wasm)" 

if test -z "$wasm_file"
    yarn add @esdmr/tree-sitter-fish
    echo "ERROR: 'tree-sitter-fish.wasm' not found"
    echo -e "try installing:\t@esdmr/tree-sitter-fish"
    echo "or build it from source:"
    echo -e "\tyarn add tree-sitter-cli https://github.com/ram02z/tree-sitter-fish"
    echo -e "\tyarn run tree-sitter build -w ./node_modules/tree-sitter-fish/ -o ./tree-sitter-fish.wasm"
    echo -e "\tyarn remove tree-sitter-cli tree-sitter-fish"
    exit 1
end

cp "$wasm_file" . --force
and echo "SUCCESS: tree-sitter-fish.wasm copied"
