#!/usr/bin/env fish

argparse --ignore-unknown h/help c/complete -- $argv
or return

if set -q _flag_h
    echo "USAGE: timestamp.fish [OPTIONS]"
    echo "  scripts/timestamp.fish [--latest | --nightly] | [-c | --complete] | [-h | --help]"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help       Show this help message"
    echo "  -c, --complete   Output shell completion script"
    echo "      --latest     Get the latest publish time"
    echo "      --nightly    Get the nightly publish time"
    echo ""
    echo "EXAMPLES:"
    echo "  # Get the `fish-lsp@latest` published timestamp"
    echo "  >_ ./scripts/timestamp.fish --latest"
    echo ""
    echo "  # Get the `fish-lsp@nightly` published timestamp"
    echo "  >_ ./scripts/timestamp.fish --nightly"
    echo ""
    echo "  # Use the latest publish timestamp for reproducible builds"
    echo "  >_ SOURCE_DATE_EPOCH=(./scripts/timestamp --latest) yarn build:npm &>/dev/null" 
    echo "  >_ and ./dist/fish-lsp --build-time # matches `fish-lsp@latest`"
    echo "  # Notice that the if we don't export SOURCE_DATE_EPOCH,"
    echo "  # the build time is overridden to current time"
    echo "  >_ yarn build:npm && ./dist/fish-lsp --build-time"
    exit 0
end

if set -q _flag_c
    echo "# "
    set -l script (path resolve -- (status current-filename))
    echo "# ./scripts/publish-timestamp.fish
    complete --path $script -f
    complete --path $script -n '__fish_use_subcommand' -k -xa \"--latest\t'Get publish timestamp from `fish-lsp@latest` tag'
--nightly\t'Get publish timestamp from `fish-lsp@nightly` tag'
-h\t'Show help message'
--help\t'Show help message'
-c\t'Output shell completion script'
--complete\t'Output shell completion script'\"
    # yarn sh:publish-time
    complete -c yarn -n '__fish_seen_subcommand_from timestamp' -f
    complete -c yarn -n '__fish_seen_subcommand_from timestamp' -l latest -d 'Get the latest publish time'
    complete -c yarn -n '__fish_seen_subcommand_from timestamp' -l nightly -d 'Get the nightly publish time'
    complete -c yarn -n '__fish_seen_subcommand_from timestamp' -s h -l help -d 'Show help message'
    complete -c yarn -n '__fish_seen_subcommand_from timestamp' -s c -l complete -d 'Output shell completion script'" | string trim -l
    exit 0
end

## Alternative implementation using external function in utils.fish:
##  >_ source ./scripts/fish/utils.fish
##  >_ get_npm_publish_time $argv

begin
    # setup identifier based on flags
    set -ql _flag_nightly
    and set -l pkg_identifier "fish-lsp@nightly" # if --nightly flag is provided use `nightly` tag
    or set -l pkg_identifier "fish-lsp@latest" # default to latest if no flag or --latest is provided

    # fetch version and publish time
    set -l pkg_version (npm show $pkg_identifier version --json 2>/dev/null | jq -r)
    set -l pkg_utc_timestamp (npm show $pkg_identifier time --json 2>/dev/null | jq -r ".\"$pkg_version\"")

    # convert to unix timestamp
    date -d "$pkg_utc_timestamp" +'%s'
end 2>/dev/null
