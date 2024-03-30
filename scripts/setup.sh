#!/usr/bin/env fish

# Future plans to convert the project to pnpm:
#
# pnpm install
# pnpm run-script build-wasm
# pnpm run-script compile
#

# yarn install
# yarn sh:build-wasm 
# yarn run compile    
# yarn run sh:build-time

# echo -e "\n\nLINKING fish-lsp"
# if command -vq fish-lsp
#     echo -e \
#     ' "fish-lsp" is already installed\n' \
#     ' UNLINKING and LINKING again'
#     yarn unlink --global "fish-lsp" &> /dev/null
# end
# yarn link --global "fish-lsp" &> /dev/null
#
# echo -e '\n"fish-lsp" is now installed and linked'
#         'fish-lsp:'(which fish-lsp)\n\
#         '> fish-lsp show-path'
#
# fish-lsp show-path