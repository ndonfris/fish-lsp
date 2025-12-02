#!/usr/bin/env fish

# ┌──────────────────────────────┐
# │ Imported variables/functions │
# └──────────────────────────────┘
source ./scripts/fish/continue-or-exit.fish
source ./scripts/fish/pretty-print.fish
source ./scripts/fish/utils.fish

# ┌─────────────────┐
# │ Parse arguments │
# └─────────────────┘
argparse \
    -x c,d -x c,bump-pre -x c,skip-confirm -x i,skip-confirm \
    h/help c/complete d/dry-run bump-pre skip-confirm i/interactive -- $argv
or exit 1

# ┌──────────────────────┐
# │ Execution mode setup │
# └──────────────────────┘
set -g DRY_RUN (set -q _flag_dry_run && echo 'true' || echo 'false')
set -g SKIP_CONFIRM (set -q _flag_skip_confirm && echo 'true' || echo 'false')
set -g INTERACTIVE (set -q _flag_interactive && echo 'true' || echo 'false')

# ┌────────────────────────────────────┐
# │ handle flags that cause early exit │
# └────────────────────────────────────┘

# Help flags: `-h` or `--help`
if set -q _flag_help
    echo -e "Usage: publish-nightly.fish [--dry-run] [--skip-confirm] [-c | --complete] [-h | --help] [--bump-pre]\n"
    echo -e "Publishes current `package.json` version to npm with nightly tags"
    echo -e "\nOptions:\n"
    echo -e "  -h, --help           Show this help message and exit"
    echo -e "  -d, --dry-run        Show what would be done without making changes"
    echo -e "      --skip-confirm   Skip all confirmation prompts"
    echo -e "  -c, --complete       Show completion commands for this script"
    echo -e "      --bump-pre       Bump the preminor version and exit"
    echo -e "  -i, --interactive    Prompt for confirmation before each step (overrides --skip-confirm)\n"
    echo -e "\nExamples:\n"
    echo -e "  >_ ./scripts/publish-nightly.fish --dry-run"
    echo -e "     Output the steps that would be taken without executing them\n"
    echo -e "  >_ ./scripts/publish-nightly.fish --bump-pre && ./scripts/publish-nightly.fish"
    echo -e "     Bump the preminor version and then publish it\n"
    echo -e "  >_ ./scripts/publish-nightly.fish --skip-confirm"
    echo -e "     Skip all confirmation prompts and publish the next release\n"
    exit 0
end

# Bump preminor flag: `--bump-pre`
if set -q _flag_bump_pre
    # Get the current preminor version from npm, increment it, and format the new version string
    set latest_version (npm show "fish-lsp@preminor" version 2>/dev/null)
    set next_version (get_next_npm_preminor_version)
    # Execute the version bump command
    exec_cmd "Bump preminor version `$latest_version` → `$next_version`" "npm pkg set version=$next_version" --interactive
    and log_info '✅' '[SUCCESS]' "Bumped preminor version to `$next_version`"
    or fail "Failed to bump preminor version"
end

# Completion flag: `-c` or `--complete`
if set -q _flag_complete
    set -l script (path resolve -- (status current-filename))
    echo "# COMPLETIONS FROM `$script -c`
    complete --path $script -f
    complete --path $script -s h -l help         -d 'Show this help message'
    complete --path $script -s d -l dry-run      -d 'Show what would happen without executing'
    complete --path $script -s c -l complete     -d 'Show completion commands for this script'
    complete --path $script      -l skip-confirm -d 'Don\'t prompt for confirmation'
    complete --path $script -l bump-pre -d 'Bump the preminor version and exit'
    complete --path $script -s i -l interactive  -d 'Prompt for confirmation before each step (overrides --skip-confirm)'
    # yarn publish-nightly
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -f
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -s h -l help         -d 'Show this help message'
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -s d -l dry-run      -d 'Show what would happen without executing'
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -s c -l complete     -d 'Show completion commands for this script'
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly'      -l skip-confirm -d 'Don\'t prompt for confirmation'
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -l bump-pre -d 'Bump the preminor version and exit'
    complete -c yarn -n '__fish_seen_subcommand_from publish-nightly' -s i -l interactive  -d 'Prompt for confirmation before each step (overrides --skip-confirm)'
    " | string trim -l
    exit 0
end

# ┌────────────────┐
# │ main execution │
# └────────────────┘
log_info '' '[INFO]' "Starting$BOLD_BLUE nightly+preminor$CYAN publish..."

# ┌──────────────────────┐
# │ setup info variables │
# └──────────────────────┘
set package_name (get_npm_pkg_name)
set package_version (get_npm_pkg_version)
test -z "$package_name" -o -z "$package_version"; and fail "Cannot read package.json"
log_info '📦' '[INFO]' "Package: $BLUE$package_name@$package_version$NORMAL"
set git_tag "v$package_version"
set npm_url (get_npm_url)

# ┌─────────────────────┐
# │ check tag conflicts │
# └─────────────────────┘
check_and_fix_tag; or fail "Pre-publish checks failed"

# ┌───────────────┐
# │ Confirm BEGIN │
# └───────────────┘
log_info '📋' '[PLAN]' "Package: $BLUE$package_name@$package_version$NORMAL →$GREEN npm:preminor,nightly$NORMAL +$BRIGHT_GREEN git:$git_tag$NORMAL"
confirm "Proceed with publish"; or fail "Aborted by user"

# ┌───────────────────────┐
# │ Execute publish steps │
# └───────────────────────┘
# npm
exec_cmd "Publish to npm" "npm publish --tag preminor" --interactive --numbered; or fail "npm publish failed"
exec_cmd "Add nightly tag" "npm dist-tag add $package_name@$package_version nightly" --interactive --numbered; or fail "dist-tag failed"
# git 
exec_cmd "Create git tag" "git tag -a $git_tag -m 'Published to npm: $npm_url'" --interactive --numbered; or fail "git tag failed"
exec_cmd "Push git tag" "git push origin $git_tag" --interactive --numbered; or fail "git push failed"

# ┌───────────────────────┐
# │ Final success message │
# └───────────────────────┘
not $DRY_RUN; and log_info '✅' '[SUCCESS]' "Published $BLUE$package_name@$package_version$NORMAL"
$DRY_RUN; and log_info '󰜎' '[DRY RUN]' "Would have published: $BLUE$package_name@$package_version$NORMAL"
or log_info '' '[DONE]' 'Finished successfully'
