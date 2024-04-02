#!/usr/bin/env fish


# Relink a globally installed package to the local package
# that was called by this script. If the global package
# is not installed, it will be installed globally.
# Use this for testing changes to the fish-lsp package.

# Usage: ./relink-locally.sh


# yarn install 

echo -e "\nRelinking 'fish-lsp' globally..."
if command -vq fish-lsp
    echo -e \
    ' "fish-lsp" is already installed\n' \
    ' UNLINKING and LINKING again'
    yarn unlink --global 'fish-lsp' 2>> /dev/null
    yarn global remove 'fish-lsp' 2>> /dev/null
end
yarn link --global "fish-lsp" --force
echo -e '\n"fish-lsp" is now installed and linked'
