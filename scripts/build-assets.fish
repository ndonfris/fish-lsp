#!/usr/bin/env fish

#
# build-assets.fish
#
# Creates the release assets for GitHub releases
# These files are included in the release-assets/ folder:
#   - fish-lsp             (standalone binary)
#   - fish-lsp.1           (man page) 
#   - fish-lsp.fish        (shell completions)
#   - fish-lsp-*.tgz       (npm package tarball)
#   - sourcemaps.tar.gz    (sourcemap files archive)
#

source ./scripts/continue_or_exit.fish
source ./scripts/pretty-print.fish

argparse h/help y/yes c/complete clean -- $argv 2>/dev/null
or return 1

if set -q _flag_help
    echo "Usage: ./scripts/build-assets.fish [OPTIONS]"
    echo ""
    echo "Creates release assets for GitHub releases in the release-assets/ directory"
    echo ""
    echo "Options:"
    echo "  -h, --help        Show this help message"
    echo "  -d, --dry-run     Show what would happen without executing"
    echo "  -y, --yes         Skip confirmation prompts"
    echo "  -c, --complete    Show completion commands for this script"
    echo "  --clean           Clean existing release-assets/ directory first"
    echo ""
    echo "Generated files:"
    echo "  release-assets/fish-lsp             Standalone binary"
    echo "  release-assets/fish-lsp.1           Man page"
    echo "  release-assets/fish-lsp.fish        Shell completions"
    echo "  release-assets/fish-lsp-*.tgz       NPM package tarball"
    echo "  release-assets/sourcemaps.tar.gz    Sourcemap files archive"
    exit 0
end

if set -q _flag_complete
    function show_completion -d 'show the \'complete\' commands for this script'
        set -l script (path resolve -- (status current-filename))
        echo "
            complete --path $script -f
            complete --path $script -s h -l help -d 'Show this help message'
            complete --path $script -s d -l dry-run -d 'Show what would happen without executing'
            complete --path $script -s c -l complete -d 'Show completion commands for this script'
            complete --path $script -l clean -d 'Clean existing release-assets/ directory first'
            # yarn publish-assets
            complete -c yarn -n '__fish_seen_subcommand_from sh:build-assets' -f
            complete -c yarn -n '__fish_seen_subcommand_from sh:build-assets' -s h -l help -d 'Show this help message'
            complete -c yarn -n '__fish_seen_subcommand_from sh:build-assets' -s d -l dry-run -d 'Show what would happen without executing'
            complete -c yarn -n '__fish_seen_subcommand_from sh:build-assets' -s c -l complete -d 'Show completion commands for this script'
            complete -c yarn -n '__fish_seen_subcommand_from sh:build-assets' -l clean -d 'Clean existing release-assets/ directory first'
        " | string trim -l
    end
    set -l cachedir (__fish_make_cache_dir completions 2>/dev/null)
    show_completion
    show_completion | source -
    show_completion >$cachedir/publish-assets.fish
    __fish_cache_put $cachedir/publish-assets.fish
    source "$cachedir/publish-assets.fish"
    return 0
end

function fail -d 'Exit with error message'
    log_error '❌' '[ERROR]' $argv
    exit 1
end

function confirm --argument-names message
    if $SKIP_CONFIRMATION
        return 0
    end

    argparse --ignore-unknown no-exit -- $argv[2..]
    or return

    if not continue_or_exit --quiet --time-in-prompt --prepend-prompt=$message --prompt-str="$BOLD$WHTIE'[Y/n]?'$NORMAL"
        set -q _flag_no_exit && log_error '❌' '[ERROR]' 'User declined the operation.'
        or fail 'User declined operation.'
        return 1
    end
    log_info '✅' '[INFO]' 'User confirmed the operation!'
    return 0
end

function check_for_completion_errors -d 'Check for completion errors'

    test -f dist/fish-lsp && test -f bin/fish-lsp 1>/dev/null
    or return 1

    dist/fish-lsp complete | fish -n 1>/dev/null
    or return 1

    dist/fish-lsp info --time-only 1>/dev/null
    or return 1
end

if set -q _flag_clean
    if test -d release-assets
        log_warning '⚠️' '[WARNING]' 'release-assets/ directory already exists and will be removed.'
        confirm 'Do you want to clean it?'
        rm -rf release-assets
    else
        log_info 'ℹ️' '[INFO]' 'No existing release-assets/ directory to clean.'
    end
    confirm 'Proceed with creating a new release-assets/ directory?'
    or fail 'User declined to create release-assets/ directory.'
end

set -g SKIP_CONFIRMATION (set -q _flag_yes && echo 'true' || echo 'false')

print_separator
echo $BLUE"🗂️  CREATE ASSETS SCRIPT$WHITE$BOLD ./release-assets/$NORMAL$BLUE "$NORMAL
print_separator

confirm "BUILD ASSETS FOR PUBLISHING?"

if test -d release-assets
    log_warning '⚠️' '[WARNING]' 'release-assets/ directory already exists.'
    confirm 'Do you want to clean it?'
    rm -rf release-assets
    mkdir -p release-assets
else
    log_info 'ℹ️' '[INFO]' 'Creating release-assets/ directory...'
    mkdir -p release-assets
    or fail 'Failed to create release-assets/ directory.'
    log_info '✅' '[INFO]' 'release-assets/ directory created successfully!'
end

if $SKIP_CONFIRMATION || not test -f ./dist/fish-lsp
    yarn install && yarn dev && yarn generate:man
else if confirm "$BLUE$UNDERLINE$BOLD BUILD FRESH PROJECT OUTPUT INSTEAD OF USING EXISTING BUILD?$NORMAL" --no-exit
    yarn install

    confirm "CLEAN BEFORE BUILDING?" --no-exit
    and yarn clean:all
    mkdir -p release-assets
    yarn install && yarn dev && yarn generate:man
    if test $status -ne 0
        log_error '❌' '[ERROR]' 'Failed to install dependencies or build the project.'
        exit 1
    end
    log_info '✅' '[INFO]' 'Project built successfully!'
end

check_for_completion_errors

confirm "COPY BINARY:$WHITE release-assets/fish-lsp $NORMAL" --no-exit
and cp dist/fish-lsp release-assets/fish-lsp

confirm "GENERATE COMPLETIONS FILE:$WHITE release-assets/fish-lsp.fish $NORMAL" --no-exit
and dist/fish-lsp complete >release-assets/fish-lsp.fish
or log_warning '⚠️' '[WARNING]' 'Skipping completions generation.'

confirm "CREATE MAN PAGE:$WHITE release-assets/fish-lsp.1 $NORMAL" --no-exit
and yarn generate:man && cp man/fish-lsp.1 release-assets/fish-lsp.1
or log_warning '⚠️' '[WARNING]' 'Skipping creation of manpage'

confirm "CREATE SOURCEMAPS ARCHIVE:$WHITE release-assets/sourcemaps.tar.gz $NORMAL" --no-exit
set -l sourcemap_files dist/fish-lsp.map lib/fish-lsp-web.js.map
or log_warning '⚠️' '[WARNING]' 'Skipping creation of sourcemaps archive'

set -l existing_files
set -l sourcemap_files dist/fish-lsp.map lib/fish-lsp-web.js.map
for file in $sourcemap_files
    if test -f $file
        set -a existing_files $file
    else
        echo $YELLOW"⚠️  Warning: Sourcemap file not found: $file"$NORMAL
    end
end

if test (count $existing_files) -gt 0
    confirm "CREATE SOURCEMAPS ARCHIVE:$WHITE release-assets/sourcemaps.tar.gz with files: $existing_files $NORMAL" --no-exit
    and tar -czf release-assets/sourcemaps.tar.gz $existing_files
    or log_warning '⚠️' '[WARNING]' 'Skipping creation of sourcemaps archive'
else
    echo $YELLOW"⚠️  Warning: No sourcemap files found, skipping archive creation"$NORMAL
end

if confirm "CREATE `npm pack` PACKAGE:$WHITE release-assets/fish-lsp-*.tgz $NORMAL" --no-exit
    log_info 'ℹ️' '[INFO]' 'Creating npm package...'
    npm pack
    set -l tgz_file (command ls -t *.tgz 2>/dev/null | head -n1)
    if test -n "$tgz_file"
        mv "$tgz_file" release-assets/
    else
        log_error '❌' '[ERROR]' 'No .tgz file found after npm pack'
        exit 1
    end
else
    log_warning '⚠️' '[WARNING]' 'Skipping npm package creation.'
end

echo ""
log_info '✅' '[INFO]' 'Release assets created successfully!'
