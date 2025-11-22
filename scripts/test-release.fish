#!/usr/bin/env fish

yarn install
yarn build:npm

mkdir -p release-assets/{npm,yarn}/

npm pack --pack-destination ./release-assets/npm
yarn pack --filename release-assets/yarn/fish-lsp.tgz

mv release-assets/npm/fish-lsp-(npm pkg get version | string unescape).tgz ./release-assets/npm/fish-lsp.tgz

function sep
    set_color magenta
    string repeat --count 60 -
    set_color normal
end

function echo_cmd
    sep
    echo "$(set_color white)>_ $(set_color blue)$argv$(set_color normal)"
    eval $argv
    echo
end

for pkg_manager in {npm,yarn}
    set -l file ./release-assets/$pkg_manager/fish-lsp.tgz
    sep && echo "Testing package: $file" && sep
    npm un -g fish-lsp 2>/dev/null || true
    npm i -g $file
    echo_cmd fish-lsp --version
    echo_cmd fish-lsp --help
    echo_cmd fish-lsp info
    echo_cmd fish-lsp info --path
    echo_cmd fish-lsp env
    echo_cmd fish-lsp start --dump
    echo_cmd fish-lsp complete
    echo_cmd fish-lsp info --time-startup
    echo_cmd fish-lsp info --dump-parse-tree ./tests/workspaces/workspace_1/fish/config.fish
    echo_cmd fish-lsp info --dump-semantic-tokens ./tests/workspaces/workspace_1/fish/config.fish
    sep
end

npm un -g fish-lsp
