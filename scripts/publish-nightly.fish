#!/usr/bin/env fish

# ┌──────────────────────────────┐
# │ Imported variables/functions │
# └──────────────────────────────┘
source ./scripts/continue_or_exit.fish
source ./scripts/pretty-print.fish


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

# ┌───────────────────┐
# │ Utility functions │
# └───────────────────┘

# wrapper to prevent evaling command when --dry-run,
# added 
# otherwise log the description and execute the command
function exec_cmd -a description command -d 'Executes a command with logging and dry-run support.'
    argparse --stop-nonopt --ignore-unknown i/interactive -- $argv[3..]
    or return 1

    if $DRY_RUN
        log_info '󰜎' '[DRY RUN]' "Would execute: $BLUE>_$NORMAL `$BOLD_WHITE$command$NORMAL`"
        return 0
    end

    log_info '' '[EXEC]' "$description"
    set should_confirm (set -q _flag_i || $INTERACTIVE; and echo 'true' || echo 'false')
    $should_confirm && $SKIP_CONFIRM && set should_confirm 'false'
    if $should_confirm
        confirm "Execute: `$BOLD_WHITE$command$NORMAL`"
        or fail "Aborted by user"
    end
    eval $command
end

# wrapper to format confirmation prompts and handle dry-run or skip-confirm
# if exit status is 0, then the user confirmed, otherwise it failed
function confirm -a message -d 'Prompts the user for confirmation before proceeding.'
    if $SKIP_CONFIRM; or $DRY_RUN
        $DRY_RUN && log_info '󰜎' '[DRY RUN]' "Would prompt: $BLUE$message$NORMAL"
        return 0
    end
    continue_or_exit --time-in-prompt --prepend-prompt="$BLUE$message$NORMAL" --prompt-str="$BOLD_WHITE [Y/n]? $NORMAL" --no-empty-accept --quiet 2>/dev/null
    or return 1
    return $status
end

# wrapper to format logging when the script should halt execution and exit early
function fail -a message -d 'Logs an error message and exits with status 1.'
    log_error '❌' '[ERROR]' $message
    exit 1
end

# outputs text for the following: latest npm preminor version, git remote tags, and local git tags
function check_exists -a type item -d 'Checks if an item exists in the specified type (npm, git-remote, git-local).'
    switch $type
        case npm
            npm show $item version &>/dev/null
        case git-remote
            git ls-remote --tags origin $item | grep -q "refs/tags/$item\$"
        case git-local
            git tag -l $item | grep -q "^$item\$"
    end
end

# outputs the next preminor version based on the latest npm preminor version
function bump_preminor_version -d 'echo the next preminor version based on the latest npm preminor version'
    set latest (npm show "fish-lsp@preminor" version 2>/dev/null)
    set -l parts (string split '.' $latest)
    set next_version "$parts[1].$parts[2].$parts[3]."(math $parts[4] + 1)
    echo $next_version
end

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
    set next_version (bump_preminor_version)
    # Execute the version bump command
    exec_cmd "Bump preminor version `$latest_version` → `$next_version`" "npm pkg set version=$next_version" --interactive
    and log_info '✅' '[SUCCESS]' "Bumped preminor version to `$next_version`"
    or fail "Failed to bump preminor version"

    exit 0
end

# Completion flag: `-c` or `--complete`
if set -q _flag_complete
    function show_completion -d 'outputs completions for this script'
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
    end
    set -l cachedir (__fish_make_cache_dir completions)
    show_completion
    show_completion | source
    show_completion >$cachedir/publish-nightly.fish
    __fish_cache_put $cachedir/publish-nightly.fish
    source "$cachedir/publish-nightly.fish"
    exit 0
end

# ┌────────────────┐
# │ main execution │
# └────────────────┘

log_info '' '[INFO]' "Starting$BOLD_BLUE nightly+preminor$CYAN publish..."

# Get package info
set package_name (npm pkg get name | string unescape 2>/dev/null)
set package_version (npm pkg get version | string unescape 2>/dev/null)
test -z "$package_name" -o -z "$package_version"; and fail "Cannot read package.json"
log_info '📦' '[INFO]' "Package: $BLUE$package_name@$package_version$NORMAL"

# Check conflicts
set git_tag "v$package_version"
check_exists npm "$package_name@$package_version"; and fail "Version $package_version already on npm"
check_exists git-remote $git_tag; and fail "Tag $git_tag already on remote"

# Handle local tag conflict
if check_exists git-local $git_tag
    log_warning '⚠️' '[WARNING]' "Local tag $git_tag exists"
    confirm "Delete local tag $git_tag"; or fail "Aborted by user"
    exec_cmd "Delete local tag" "git tag -d $git_tag" --interactive; or fail "Failed to delete local tag"
end

# Confirm operation
log_info '📋' '[PLAN]' "Package: $BLUE$package_name@$package_version$NORMAL →$GREEN npm:preminor,nightly$NORMAL +$BRIGHT_GREEN git:$git_tag$NORMAL"
confirm "Proceed with publish"; or fail "Aborted by user"

# Execute publish steps
exec_cmd "Publish to npm" "npm publish --tag preminor" --interactive; or fail "npm publish failed"
exec_cmd "Add nightly tag" "npm dist-tag add $package_name@$package_version nightly" --interactive; or fail "dist-tag failed"

set npm_url "https://www.npmjs.com/package/$package_name/v/$package_version"
exec_cmd "Create git tag" "git tag -a $git_tag -m 'Published to npm: $npm_url'" --interactive; or fail "git tag failed"
exec_cmd "Push git tag" "git push origin $git_tag" --interactive; or fail "git push failed"

# Success
not $DRY_RUN; and log_info '✅' '[SUCCESS]' "Published $BLUE$package_name@$package_version$NORMAL"
$DRY_RUN; and log_info '󰜎' '[DRY RUN]' "Would have published: $BLUE$package_name@$package_version$NORMAL"
