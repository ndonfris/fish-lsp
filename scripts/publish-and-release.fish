#!/usr/bin/env fish

# ┌──────────────────────────────┐
# │ Imported variables/functions │
# └──────────────────────────────┘
source ./scripts/continue-or-exit.fish
source ./scripts/pretty-print.fish
source ./scripts/utils.fish

# ┌─────────────────┐
# │ Parse arguments │
# └─────────────────┘
argparse \
    -x c,d -x c,skip-confirm -x i,skip-confirm \
    h/help c/complete d/dry-run skip-confirm i/interactive -- $argv
or exit 1

# ┌──────────────────────┐
# │ Execution mode setup │
# └──────────────────────┘
set -g DRY_RUN (set -q _flag_dry_run && echo 'true' || echo 'false')
set -g SKIP_CONFIRM (set -q _flag_skip_confirm && echo 'true' || echo 'false')
set -g INTERACTIVE (set -q _flag_interactive && echo 'true' || echo 'false')

# ┌─────────────┐
# │ Help output │
# └─────────────┘
if set -ql _flag_help
    echo 'Usage: publish-and-release.fish [OPTIONS]'
    echo ''
    echo 'Publishes the latest version of the package to npm and creates a corresponding Git tag and GitHub release.'
    echo ''
    echo 'Options:'
    echo '  -d, --dry-run            Simulate the publish process without making any changes.'
    echo '      --skip-confirm       Skip all confirmation prompts.'
    echo '  -i, --interactive        Prompt for confirmation before each major step.'
    echo '  -h, --help               Show this help message and exit.'
    exit 0
end

# ┌────────────────────┐
# │ Completion output  │
# └────────────────────┘
if set -ql _flag_complete
    set -l script (path resolve -- (status current-filename))
    echo "# COMPLETIONS FROM `$script -c`
    complete --path $script -f
    complete --path $script -s h -l help         -d 'Show this help message'
    complete --path $script -s d -l dry-run      -d 'Show what would happen without executing'
    complete --path $script -s c -l complete     -d 'Show completion commands for this script'
    complete --path $script      -l skip-confirm -d 'Don\'t prompt for confirmation'
    complete --path $script -s i -l interactive  -d 'Prompt for confirmation before each step (overrides --skip-confirm)'
    # yarn publish-and-release
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release' -f
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release' -s h -l help         -d 'Show this help message'
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release' -s d -l dry-run      -d 'Show what would happen without executing'
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release' -s c -l complete     -d 'Show completion commands for this script'
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release'      -l skip-confirm -d 'Don\'t prompt for confirmation'
    complete -c yarn -n '__fish_seen_subcommand_from publish-and-release' -s i -l interactive  -d 'Prompt for confirmation before each step (overrides --skip-confirm)'" | string trim -l
    exit 0
end


# ┌───────────────┐
# │ Main program  │
# └───────────────┘
log_info '' '[INFO]' $CYAN"Starting$BOLD_BLUE latest$CYAN publish..."

# make sure package.json exists
not test -f package.json && fail "$WHITE`package.json`$RED not found in the current directory."

# ┌─────────────────┐
# │ setup variables │
# └─────────────────┘
set package_name (get_npm_pkg_name)
set package_version (get_npm_pkg_version)
test -z "$package_name" -o -z "$package_version"; and fail "Cannot read package.json"
log_info '📦' '[INFO]' "Package: $BLUE$package_name@$package_version$NORMAL"
set git_tag "v$package_version"
set npm_url (get_npm_url)

# Check conflicts
check_and_fix_tag; or fail "Pre-publish checks failed"

# Confirm operation
log_info '📋' '[PLAN]' "Package: $BLUE$package_name@$package_version$NORMAL →$GREEN npm:latest$NORMAL +$BRIGHT_GREEN git:$git_tag$NORMAL"
confirm "Proceed with publish"; or fail "Aborted by user"

# ┌──────────────────┐
# │ begin publishing │
# └──────────────────┘
exec_cmd 'Build pre-release assets' 'yarn sh:build-assets' --interactive --numbered; or fail 'Failed to build assets'
exec_cmd "Publish package to npm" "npm publish" --interactive --numbered; or fail "Failed to publish package to npm"
exec_cmd "Create git tag $git_tag" "git tag -a $git_tag -m '$npm_url'" --interactive --numbered; or fail "Failed to create git tag"
exec_cmd "Push git tag $git_tag to origin" "git push origin $git_tag" --interactive --numbered; or fail "Failed to push git tag to origin"
exec_cmd "Create GitHub release $git_tag" "gh release create $git_tag --draft --generate-notes --prerelease" --interactive --numbered; or fail "Failed to create GitHub release"
exec_cmd "Upload assets to GitHub release $git_tag" "gh release upload $git_tag release-assets/*" --interactive --numbered; or fail "Failed to upload assets to GitHub release"

# Success
not $DRY_RUN; and log_info '✅' '[SUCCESS]' "Published $BLUE$package_name@$package_version$NORMAL"
$DRY_RUN; and log_info '󰜎' '[DRY RUN]' "Would have published: $BLUE$package_name@$package_version$NORMAL"
or log_info '' '[DONE]' 'Finished successfully'

# yarn sh:build-assets
# and git tag -a v1.1.0 -m 'v1.1.0' 
# and git push origin v1.1.0 
# and yarn publish 
# and gh release create v1.1.0 --draft --generate-notes --prerelease 
# and gh release upload v1.1.0 release-assets/*  
