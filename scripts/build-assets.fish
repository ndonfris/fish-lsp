#!/usr/bin/env fish

#
# build-assets.fish
#
# Creates the release assets for GitHub releases
# These files are included in the release-assets/ folder:
#   - fish-lsp             (standalone binary)
#   - fish-lsp.map         (source map)
#   - fish-lsp.d.ts        (TypeScript declarations)
#   - fish-lsp.1           (man page) 
#   - fish-lsp.fish        (shell completions)
#   - fish-lsp-*.tgz       (npm package tarball)
#

source ./scripts/continue_or_exit.fish
source ./scripts/pretty-print.fish

argparse clean fresh-install -- "$argv"
or fail 'Failed to parse arguments.'

if set -q _flag_clean
    not test -d release-assets && 
    and log_warning '⚠️' '[WARNING]' 'release-assets/ directory does not exist. Nothing to clean.'
    and exit 0

    rm -rf release-assets 
    and success ' Cleaned up release-assets/ directory. '
    exit 0
end

if test -d release-assets
    log_warning '⚠️' '[WARNING]' 'release-assets/ directory already exists and will be removed.'
    rm -rf release-assets
end

if not test -d release-assets
    log_info 'ℹ️' '[INFO]' 'Creating release-assets/ directory...'
    mkdir -p release-assets
    or fail 'Failed to create release-assets/ directory.'
    log_info '✅' '[INFO]' 'release-assets/ directory created successfully!'
end

log_info 'ℹ️' '[INFO]' 'Building project...'
yarn clean:packs &>/dev/null

if set -q _flag_fresh_install || not test -f dist/fish-lsp
    yarn install && yarn dev
    or fail 'Failed to install dependencies.'
end

log_info '✅' '[INFO]' 'Project built successfully!'

echo 'n' | npm pack &> /dev/null
or fail 'Failed to create npm package tarball.'

mv fish-lsp-*.tgz release-assets/

cp dist/fish-lsp release-assets/fish-lsp
cp dist/fish-lsp.map release-assets/fish-lsp.map
cp dist/fish-lsp.d.ts release-assets/fish-lsp.d.ts

yarn generate:man &>/dev/null && cp man/fish-lsp.1 release-assets/fish-lsp.1
dist/fish-lsp complete > release-assets/fish-lsp.fish

print_separator

set_color --bold green
tree ./release-assets/
set_color normal

print_separator

success " All assets built successfully! "
