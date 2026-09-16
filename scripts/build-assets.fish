#!/usr/bin/env fish

# Automation script to build all assets for releasing fish-lsp. The files
# outputted by this script are intended to be located in the release-assets/
# folder. Every asset is built in a temporary release-build-*/ folder, which is
# removed when the script exits, so dist/ and bin/ are never touched.
#
# These files are included in the release-assets/ folder:
#   - fish-lsp.standalone                                  (standalone binary -- bundled dependencies into a single executable, npm package will be smaller)
#   - fish-lsp.standalone.with-all-assets.tar             (standalone binary w/ inline sourcemaps, manpage, and TypeScript declarations)
#   - fish-lsp.tgz                                         (npm packaged tarball)
#   - fish-lsp.external-sourcemaps.tgz                     (npm packaged tarball, opt-in sourcemaps by adding fish-lsp.map beside dist/fish-lsp)
#   - fish-lsp.map                                         (external sourcemaps for fish-lsp.external-sourcemaps.tgz)
#   - fish-lsp.1                                           (man page)
#   - fish-lsp.fish                                        (shell completions)
#
# Usage:
#
#   Build assets, and upload them to a GitHub release
#   >_ yarn sh:build-assets [--clean] [--fresh-install]
#   >_ gh release upload <tag> ./release-assets/*
#
#   >_ fish ./scripts/build-assets.fish # Build assets without using yarn
#

source ./scripts/fish/continue-or-exit.fish
source ./scripts/fish/pretty-print.fish

argparse clean fresh-install h/help -- "$argv"
or fail 'Failed to parse arguments.'

if set -q _flag_help
    echo 'Usage:'
    echo '  yarn sh:build-assets [--clean] [--fresh-install] [--help]'
    echo '  fish ./scripts/build-assets.fish [--clean] [--fresh-install] [--help]'
    echo ''
    echo 'Synopsis:'
    echo '  Script to build all assets for releasing fish-lsp. Assets are outputted'
    echo '  in the ./release-assets/ directory.'
    echo ''
    echo 'Options:'
    echo '  --clean            Remove the release-assets/ directory and exit.'
    echo '  --fresh-install    Install dependencies from scratch before building.'
    echo '  -h, --help         Show this help message and exit.'
    exit 0
end

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

if set -q fish_lsp_tree_sitter_wasm_path && test -f "$fish_lsp_tree_sitter_wasm_path"
    log_info '' '[INFO]' 'Build used variable $fish_lsp_tree_sitter_wasm_path' 
    command cp $fish_lsp_tree_sitter_wasm_path release-assets/tree-sitter-fish.wasm
    and log_info '' '[INFO]' 'Copied $fish_lsp_tree_sitter_wasm_path to release-assets/tree-sitter-fish.wasm' 
    or fail 'Failed to copy $fish_lsp_tree_sitter_wasm_path to release-assets/tree-sitter-fish.wasm'
end

# Every asset is built in its own release-build-*/ folder instead of dist/ and bin/, so a
# developer's build, global `fish-lsp` link and completions are left alone. The folders sit one
# level below the repo root, so source maps keep their `../src/` paths. They are removed when
# the script exits, including when a step fails or the script is interrupted.
set -g release_build_paths
function remove_release_build_paths --on-event fish_exit
    rm -rf $release_build_paths
end
function exit_on_signal --on-signal INT --on-signal TERM --on-signal HUP
    exit 130
end

# `release_build <name> <yarn dev flags...>` builds into release-build-<name>/, and only
# prints the build output when the build fails
function release_build --argument-names name
    set -l folder release-build-$name
    test -e $folder
    and fail "Directory $folder/ already exists, likely from an interrupted run. Remove it and try again."
    set -ga release_build_paths $folder
    set -l output (yarn -s dev $argv[2..] --build-target-folder=$folder 2>&1)
    or begin
        printf '%s\n' $output
        return 1
    end
end

release_build npm --npm
or fail 'Failed to build the npm package.'
release_build standalone --binary
or fail 'Failed to build the standalone binary.'
release_build external-sourcemaps --external-sourcemaps
or fail 'Failed to build the npm package with external sourcemaps.'

log_info '' '[INFO]' 'Project built successfully!'

# `pack_npm_tarball <asset> <dist files...>` writes release-assets/<asset>, an npm tarball whose
# dist/ holds exactly the given files. `yarn pack` supplies the rest of the package.
function pack_npm_tarball --argument-names asset
    set -l stage (mktemp -d)
    set -ga release_build_paths $stage
    yarn pack --filename $stage/package.tgz --silent
    and tar -xzf $stage/package.tgz -C $stage
    and rm -rf $stage/package/dist
    and mkdir -p $stage/package/dist
    and command cp $argv[2..] $stage/package/dist/
    and tar -czf release-assets/$asset -C $stage package
end

log_info '' '[INFO]' 'Creating npm package tarball...'
pack_npm_tarball fish-lsp.tgz release-build-npm/fish-lsp release-build-npm/fish-lsp.d.ts
or fail 'Failed to create npm package tarball.'

log_info '' '[INFO]' 'Creating npm package tarball (external sourcemaps)...'
pack_npm_tarball fish-lsp.external-sourcemaps.tgz release-build-external-sourcemaps/fish-lsp release-build-npm/fish-lsp.d.ts
and command cp release-build-external-sourcemaps/fish-lsp.map release-assets/fish-lsp.map
or fail 'Failed to create npm package tarball (external sourcemaps).'

log_info '' '[INFO]' 'Creating release-assets extra files...'
# Generated straight into release-assets/, so the tracked man/fish-lsp.1 is not rewritten
yarn run -s generate:man:cat >release-assets/fish-lsp.1
or fail 'Failed to generate release-assets/fish-lsp.1'
release-build-standalone/fish-lsp complete >release-assets/fish-lsp.fish
or fail 'Failed to generate release-assets/fish-lsp.fish'

log_info '' '[INFO]' 'Creating tarball for extra files...'
set -l extras (mktemp -d)
set -ga release_build_paths $extras
mkdir -p $extras/bin $extras/man $extras/dist
and command cp release-build-standalone/fish-lsp $extras/bin/fish-lsp
and command cp release-assets/fish-lsp.1 $extras/man/fish-lsp.1
and command cp release-build-npm/fish-lsp.d.ts $extras/dist/fish-lsp.d.ts
and tar -cf release-assets/fish-lsp.standalone.with-all-assets.tar -C $extras bin man dist/fish-lsp.d.ts
or fail 'Failed to create release-assets/fish-lsp.standalone.with-all-assets.tar'

log_info '' '[INFO]' 'Copying standalone binary to release-assets/ directory...'
command cp release-build-standalone/fish-lsp release-assets/fish-lsp.standalone
or fail 'Failed to copy the standalone binary to release-assets/fish-lsp.standalone'

log_info '' '[INFO]' 'Removing release-build-*/ folders...'
rm -rf $release_build_paths
and set -e release_build_paths

print_separator
echo ''

set_color --bold green
yarn exec -- npx -s -y tree-cli --base ./release-assets/
or true
set_color normal

print_separator

success " All assets built successfully! 📦 "
