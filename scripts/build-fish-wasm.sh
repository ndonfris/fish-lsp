#!/usr/bin/env fish

yarn add web-tree-sitter
# yarn add --dev tree-sitter-cli https://github.com/ram02z/tree-sitter-fish
# IMPORTANT: use this fork of tree-sitter-fish until the PR is merged: 
#      https://github.com/esdmr/tree-sitter-fish

yarn add --save @esdmr/tree-sitter-fish


function in_place_echo_tree-sitter-fish_wasm -d 'Check if tree-sitter-fish.wasm is in node_modules/@esdmr/tree-sitter-fish'

    if not test -d "./node_modules/@esdmr/tree-sitter-fish" || not test -d "./node_modules/tree-sitter-fish"
        begin
            yarn add --dev tree-sitter-cli https://github.com/ram02z/tree-sitter-fish 
            yarn add --save @esdmr/tree-sitter-fish
        end 1&>> /dev/null
        or return 1
    end
    if test -f ./node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm
        command echo "./node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm"
        and return 0
    end
    
    ## fallback posix method using find 
    set -l wasm_file_path "$(find node_modules/ -type f -a -name tree-sitter-fish.wasm)"
    if test -f "$wasm_file_path"  && test -O "$wasm_file_path"
        command echo $wasm_file_path
        and return 0
    else if not test -O "$wasm_file_path"
        command echo $wasm_file_path
        and return 0
    end
    echo ""
    return 1
end

function cp_tree-sitter-fish_wasm --argument-names wasm_file_path -d 'Copy tree-sitter-fish.wasm to the root directory'
    if test -z "$wasm_file_path" || not test -f "$wasm_file_path"
        command echo "tree-sitter-fish.wasm not found"
        and exit 1
    end
    if test -O "$wasm_file_path"
        command echo "Copying tree-sitter-fish.wasm to the root directory"
        and cp -f $wasm_file_path ./tree-sitter-fish.wasm
        and return 0
    else
        command echo "tree-sitter-fish.wasm not built properly, please check the build process"
        and return 1
    end
end

set -l wasm_file_path (in_place_echo_tree-sitter-fish_wasm)
and cp_tree-sitter-fish_wasm "$wasm_file_path"

# npx tree-sitter build -w ./node_modules/tree-sitter-fish/ -o ./tree-sitter-fish.wasm
#
# yarn remove tree-sitter-cli tree-sitter-fish
