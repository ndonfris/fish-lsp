#!/usr/bin/env fish

# These files are included in the release-assets/ folder:
#   - fish-lsp.standalone                                  (standalone binary -- bundled dependencies into a single executable, npm package will be smaller)
#   - fish-lsp.standalone.extra-assets.tar                 (standalone w/ sourcemaps, manpage, completions, and TypeScript declarations)
#   - fish-lsp.tgz                                         (npm packaged tarball)
#   - fish-lsp.1                                           (man page) 
#   - fish-lsp.fish                                        (shell completions)
#

source ./scripts/continue-or-exit.fish
source ./scripts/pretty-print.fish

argparse clean fresh-install -- "$argv"
or fail 'Failed to parse arguments.'

if set -q _flag_clean
    not test -d release-assets &&
        and log_warning '' '[WARNING]' 'release-assets/ directory does not exist. Nothing to clean.'
    and exit 0

    rm -rf release-assets
    and success ' Cleaned up release-assets/ directory. '
    exit 0
end

if test -d release-assets
    log_warning '' '[WARNING]' 'Directory release-assets/ already exists and will be removed.'
    rm -rf release-assets
end

if not test -d release-assets
    log_info '' '[INFO]' 'Creating release-assets/ directory...'
    mkdir -p release-assets
    or fail 'Failed to create release-assets/ directory.'
    log_info '' '[INFO]' 'Directory release-assets/ created successfully!'
end

log_info '' '[INFO]' 'Building project...'
yarn install &>/dev/null
if set -q _flag_fresh_install
    yarn run clean:packs &>/dev/null
    and log_info '' '[INFO]' 'Dependencies installed successfully!'
    or fail 'Failed to install dependencies.'
end
yarn build &>/dev/null

log_info '' '[INFO]' 'Project built successfully!'

log_info '' '[INFO]' 'Creating npm package tarball...'
echo n | yarn pack --filename release-assets/fish-lsp.tgz --silent
or fail 'Failed to create npm package tarball.'

log_info '' '[INFO]' 'Creating standalone binary...'
yarn build:all &>/dev/null

log_info '' '[INFO]' 'Creating release-assets extra files...'
yarn run -s generate:man &>/dev/null && cp man/fish-lsp.1 release-assets/fish-lsp.1
dist/fish-lsp complete >release-assets/fish-lsp.fish

log_info '' '[INFO]' 'Creating tarball for extra files...'
tar -cf release-assets/fish-lsp.standalone.with-all-assets.tar bin man dist/fish-lsp.d.ts &>/dev/null
or log_warning '' '[WARNING]' 'failed to create `release-assets/fish-lsp.standalone.with-all-assets.tar` archive.'

log_info '' '[INFO]' 'Copying standalone binary to release-assets/ directory...'
cp bin/fish-lsp release-assets/fish-lsp.standalone
or log_warning '' '[WARNING]' 'failed to copy `bin/fish-lsp` to `release-assets/fish-lsp.standalone`!'

print_separator
echo ''

set_color --bold green
yarn exec -- npx -s -y tree-cli --base ./release-assets/
or true
set_color normal

print_separator

success " All assets built successfully! 📦 "
