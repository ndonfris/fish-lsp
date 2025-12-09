#!/usr/bin/env fish

set -l DIR (status current-filename | path resolve | path dirname)
source "$DIR/continue-or-exit.fish"
source "$DIR/pretty-print.fish"

set -g exec_count 1

# wrapper to prevent evaling command when --dry-run,
# added 
# otherwise log the description and execute the command
function exec_cmd -a description command -d 'Executes a command with logging and dry-run support.'
    argparse --stop-nonopt --ignore-unknown i/interactive n/numbered -- $argv[3..]
    or return 1

    if $DRY_RUN
        set msg "Would execute: $BLUE>_$NORMAL `$BOLD_WHITE$command$NORMAL`"

        set -ql _flag_numbered
        and set msg "$BOLD$REVERSE STEP $exec_count $NORMAL$CYAN Would execute: $BLUE>_$NORMAL `$BOLD_WHITE$command$NORMAL`" 
        and set -g exec_count (math $exec_count+1)

        log_info '󰜎' '[DRY RUN]' "$msg"
        return 0
    end

    if set -ql _flag_numbered 
        set -f description "$CYAN$REVERSE STEP $exec_count $NORMAL$CYAN $description"
        set -g exec_count (math $exec_count+1)
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

function check_and_fix_tag -d 'Checks if both the npm package and git tags exist for the current package and version.' \
    --inherit-variable package_name \
    --inherit-variable package_version \
    --inherit-variable git_tag

    check_exists npm "$package_name@$package_version"; and fail "Version $package_version already on npm"
    check_exists git-remote $git_tag; and fail "Tag $git_tag already on remote"

    # Handle local tag conflict
    if check_exists git-local $git_tag
        log_warning '⚠️' '[WARNING]' "Local git tag $git_tag exists"
        confirm "Delete local git tag $git_tag"; or fail "Aborted by user"
        exec_cmd "Delete local git tag $git_tag" "git tag -d $git_tag" --interactive; or fail "Failed to delete local git tag"
    end
    # log_info '✅' '[CHECK]' "No conflicts found:$BLUE  $package_name@$package_version$CYAN |$BLUE  $git_tag$NORMAL"
    log_info '✅' '[CHECK]' "NO EXISTING VERSION CONFLICTS FOUND!$NORMAL"
end


function get_npm_pkg_name -d 'Gets the package name from npm.'
    npm pkg get name 2>/dev/null | string unescape
end

function get_npm_pkg_version -d 'Gets the package version from npm.'
    npm pkg get version 2>/dev/null | string unescape
end

function get_npm_url -d 'Constructs the npm package URL for the current package and version.'
    echo "https://www.npmjs.com/package/$(get_npm_pkg_name)/v/$(get_npm_pkg_version)"
end


# outputs the next preminor version based on the latest npm preminor version
function get_next_npm_preminor_version -d 'echo the next preminor version based on the latest npm preminor version'
    set latest (npm show "fish-lsp@preminor" version 2>/dev/null)
    set -l parts (string split '.' $latest)
    set next_version "$parts[1].$parts[2].$parts[3]."(math $parts[4] + 1)
    echo $next_version
end

