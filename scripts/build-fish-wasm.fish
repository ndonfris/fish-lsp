#!/usr/bin/env fish

source ./scripts/pretty-print.fish

# fish_wasm_file is only used in the nixos build step, and should otherwise be ignored 
not set -q fish_wasm_file; and set -l fish_wasm_file "$(find node_modules -type f -a -name tree-sitter-fish.wasm)"
not set -q wasm_file; and set -l wasm_file "$(find node_modules -type f -a -name tree-sitter.wasm)"

if test -z "$fish_wasm_file"
    yarn add @esdmr/tree-sitter-fish
    print_error "$BLUE'tree-sitter-fish.wasm'$RED not found in node_modules"
    # echo "ERROR: 'tree-sitter-fish.wasm' not found"
    echo -e "try installing:\t@esdmr/tree-sitter-fish"
    echo "or build it from source:"
    echo -e "\tyarn add tree-sitter-cli https://github.com/ram02z/tree-sitter-fish"
    echo -e "\tyarn run tree-sitter build -w ./node_modules/tree-sitter-fish/ -o ./tree-sitter-fish.wasm"
    echo -e "\tyarn remove tree-sitter-cli tree-sitter-fish"
    exit 1
end

if set -q wasm_file && test -z "$wasm_file"
    print_error "$BLUE'tree-sitter.wasm'$RED not found in node_modules"
    # echo "ERROR: 'tree-sitter.wasm' not found"
end

cp -f "$fish_wasm_file" . 
and print_success "copied $BLUE'tree-sitter-fish.wasm'$GREEN from location $BLUE'$fish_wasm_file'"
or print_failure "failed to copy $BLUE'tree-sitter-fish.wasm'$RED from location $BLUE'$fish_wasm_file'"

cp -f "$wasm_file" .
and print_success "copied $BLUE'tree-sitter.wasm'$GREEN from location $BLUE'$wasm_file'"
