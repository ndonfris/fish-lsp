#!/usr/bin/env fish
yarn install
yarn build-wasm
yarn compile

echo -e "\n\nLINKING fish-lsp"
if command -vq fish-lsp
    echo -e \
    ' "fish-lsp" is already installed\n' \
    ' UNLINKING and LINKING again'
    yarn unlink --global-folder "fish-lsp" &> /dev/null
end
yarn link --global-folder "fish-lsp" &> /dev/null

echo -e '\n"fish-lsp" is now installed and linked'
#         'fish-lsp:'(which fish-lsp)\n\
#         '> fish-lsp show-path'
#
# fish-lsp show-path