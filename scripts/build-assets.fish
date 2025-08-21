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

argparse --name='build-assets' \
    h/help \
    y/yes \
    d/dry-run \
    c/complete \
    clean \
    -- $argv
or exit 1

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
            complete -c yarn -n '__fish_seen_subcommand_from publish-assets' -f
            complete -c yarn -n '__fish_seen_subcommand_from publish-assets' -s h -l help -d 'Show this help message'
            complete -c yarn -n '__fish_seen_subcommand_from publish-assets' -s d -l dry-run -d 'Show what would happen without executing'
            complete -c yarn -n '__fish_seen_subcommand_from publish-assets' -s c -l complete -d 'Show completion commands for this script'
            complete -c yarn -n '__fish_seen_subcommand_from publish-assets' -l clean -d 'Clean existing release-assets/ directory first'
        " | string trim -l
    end
    set -l cachedir (__fish_make_cache_dir completions)
    show_completion
    show_completion | source -
    show_completion >$cachedir/publish-assets.fish
    __fish_cache_put $cachedir/publish-assets.fish
    source "$cachedir/publish-assets.fish"
    exit
end

set -g SKIP_CONFIRMATION (set -q _flag_yes && echo 'true' || echo 'false')

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

# Create npm package
# echo $BLUE"📦 Creating npm package..."$NORMAL
# exec_cmd "Create npm package" "npm pack"
# if test $status -eq 0
#     # Find and move the .tgz file
#     set -l tgz_file (command ls -t *.tgz 2>/dev/null | head -n1)
#     if test -n "$tgz_file"
#         exec_cmd "Move package to release-assets/" "mv '$tgz_file' release-assets/"
#         if test $status -eq 0
#             echo $GREEN"✅ Created and moved $tgz_file to release-assets/"$NORMAL
#         else
#             echo $RED"❌ Failed to move $tgz_file to release-assets/"$NORMAL
#             exit 1
#         end
#     else
#         echo $RED"❌ No .tgz file found after npm pack"$NORMAL
#         exit 1
#     end
# else
#     echo $RED"❌ Failed to run npm pack"$NORMAL
#     exit 1
# end
#
# # function ensure_built
# #     echo $BLUE"🔍 Checking if project is built..."$NORMAL
# #
# #     if not test -f dist/fish-lsp
# #         echo $YELLOW"⚠️  Binary not found at dist/fish-lsp, building project..."$NORMAL
# #         exec_cmd "Building project" "yarn build:all"
# #         if test $status -ne 0
# #             echo $RED"❌ Failed to build project"$NORMAL
# #             exit 1
# #         end
# #     end
# #
# #     if not test -f man/fish-lsp.1
# #         echo $YELLOW"⚠️  Man page not found, generating..."$NORMAL
# #         exec_cmd "Generating man page" "yarn generate:man"
# #         if test $status -ne 0
# #             echo $RED"❌ Failed to generate man page"$NORMAL
# #             exit 1
# #         end
# #     end
# #
# #     echo $GREEN"✅ Project is built"$NORMAL
# # end
#
# echo $GREEN"📁 Creating GitHub release assets..."$NORMAL
#
# # Clean existing release-assets if requested
# if set -q _flag_clean; and test -d release-assets
#     exec_cmd "Cleaning existing release-assets/" "rm -rf release-assets"
#     if test $status -ne 0
#         echo $RED"❌ Failed to clean release-assets/ directory"$NORMAL
#         exit 1
#     end
# end
#
# # Create release-assets directory
# echo $BLUE"🗂️  Creating release-assets/ directory..."$NORMAL
# if not set -q _flag_dry_run
#     if test -d release-assets
#         rm -rf release-assets
#     end
#     mkdir release-assets
#     if test $status -ne 0
#         echo $RED"❌ Failed to create release-assets/ directory"$NORMAL
#         exit 1
#     end
# end
# log_info '✅' '[INFO]' 'release-assets/ directory created successfully!'
#
# # Ensure project is built
# ensure_built
#
# # Copy binary
# echo $BLUE"🔧 Copying binary..."$NORMAL
# if test -f dist/fish-lsp
#     exec_cmd "Copy binary" "cp dist/fish-lsp release-assets/"
#     if test $status -eq 0
#         echo $GREEN"✅ Copied dist/fish-lsp to release-assets/"$NORMAL
#     else
#         echo $RED"❌ Failed to copy binary"$NORMAL
#         exit 1
#     end
# else
#     echo $RED"❌ Binary not found at dist/fish-lsp"$NORMAL
#     exit 1
# end
#
# # Copy man page  
# echo $BLUE"📖 Copying man page..."$NORMAL
# if test -f man/fish-lsp.1
#     exec_cmd "Copy man page" "cp man/fish-lsp.1 release-assets/"
#     if test $status -eq 0
#         echo $GREEN"✅ Copied man/fish-lsp.1 to release-assets/"$NORMAL
#     else
#         echo $RED"❌ Failed to copy man page"$NORMAL
#         exit 1
#     end
# else
#     echo $RED"❌ Man page not found at man/fish-lsp.1"$NORMAL
#     exit 1
# end
#
# # Generate and copy completions
# echo $BLUE"🐚 Generating and copying completions..."$NORMAL
# if test -f bin/fish-lsp; or test -f dist/fish-lsp
#     set -l binary_path bin/fish-lsp
#     if not test -f $binary_path
#         set binary_path dist/fish-lsp
#     end
#
#     exec_cmd "Generate completions" "$binary_path complete > release-assets/fish-lsp.fish"
#     if test $status -eq 0
#         echo $GREEN"✅ Generated and copied completions to release-assets/fish-lsp.fish"$NORMAL
#     else
#         echo $RED"❌ Failed to generate completions"$NORMAL
#         exit 1
#     end
# else
#     echo $RED"❌ fish-lsp binary not found at bin/fish-lsp or dist/fish-lsp"$NORMAL
#     exit 1
# end
#
# # Create sourcemaps archive
# echo $BLUE"📁 Creating sourcemaps archive..."$NORMAL
# set -l sourcemap_files dist/fish-lsp.map lib/fish-lsp-web.js.map
# set -l existing_files
#
# for file in $sourcemap_files
#     if test -f $file
#         set -a existing_files $file
#     else
#         echo $YELLOW"⚠️  Warning: Sourcemap file not found: $file"$NORMAL
#     end
# end
#
# if test (count $existing_files) -gt 0
#     if confirm "CREATE SOURCEMAPS ARCHIVE:$WHITE release-assets/sourcemaps.tar.gz with files: $existing_files $NORMAL" --no-exit
#         tar -czf release-assets/sourcemaps.tar.gz $existing_files
#         echo $GREEN"✅ Created release-assets/sourcemaps.tar.gz with files: $existing_files"$NORMAL
#     else
#         echo $RED"❌ Failed to create sourcemaps archive"$NORMAL
#         exit 1
#     end
# else
#     echo $YELLOW"⚠️  Warning: No sourcemap files found, skipping archive creation"$NORMAL
# end
#
# # Create npm package
# if confirm "CREATE `npm pack` PACKAGE:$WHITE release-assets/fish-lsp-*.tgz $NORMAL" --no-exit
#     echo "$BLUE📦 Creating npm package...$NORMAL"
#     npm pack
#     if test $status -eq 0
#         # Find and move the .tgz file
#         set -l tgz_file (command ls -t *.tgz 2>/dev/null | head -n1)
#         if test -n "$tgz_file"
#             exec_cmd "Move package to release-assets/" "mv '$tgz_file' release-assets/"
#             if test $status -eq 0
#                 echo $GREEN"✅ Created and moved $tgz_file to release-assets/"$NORMAL
#             else
#                 echo $RED"❌ Failed to move $tgz_file to release-assets/"$NORMAL
#                 exit 1
#             end
#         else
#             echo $RED"❌ No .tgz file found after npm pack"$NORMAL
#             exit 1
#         end
#     end
# else
#     echo $RED"❌ Failed to run npm pack"$NORMAL
#     exit 1
# end
#
# echo ""
# echo $GREEN"🎉 Release assets created successfully!"$NORMAL
# echo $GREEN"📁 Contents of release-assets/:"$NORMAL
#
# if not set -q _flag_dry_run
#     ls -la release-assets/
# end
#
echo ""
log_info '✅' '[INFO]' 'Release assets created successfully!'
# echo $GREEN"Ready for GitHub release! 🚀"$NORMAL
