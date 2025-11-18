#!/usr/bin/env fish 

argparse install uninstall -- $argv
or return 

set -l cached_file ~/.config/fish/conf.d/tmp-fish-lsp.fish
set -l workspace_root (path dirname (path dirname -- (status current-filename)) | path resolve)

if set -ql _flag_uninstall
    if test -f $cached_file
        echo "Uninstalling completions for fish-lsp..."
        rm -f $cached_file
        echo "Completions uninstalled."
    else
        echo "No completions found to uninstall."
    end
    exit 0
end

if set -q INSTALL_DEV_COMPLETIONS && test "$INSTALL_DEV_COMPLETIONS" = "true" || set -q _flag_install
    echo "Installing completions for fish-lsp..."
else
    echo "Skipping completions installation for fish-lsp."
    exit 0
end



echo "
if not string match -rq -- '^$workspace_root' \"\$PWD\"
    exit
end
" > $cached_file

# Append each completion to the cached file
yarn -s run dev -c >> $cached_file
# yarn -s run tag-and-publish -c >>$cached_file
yarn -s run publish-and-release -c >>$cached_file
yarn -s run publish-nightly -c >>$cached_file
node ./scripts/build-time -c >>$cached_file
yarn -s run sh:workspace-cli -c >>$cached_file
yarn -s run generate:snippets -c >>$cached_file
# fish ./scripts/build-assets.fish --complete >>$cached_file

source ~/.config/fish/config.fish

# Alternative approach using psub (sources completions dynamically without creating intermediate file)
# Uncomment to use psub instead of cached file:
# source (yarn -s run dev -c | psub)
# source (yarn -s run publish-and-release -c | psub)
# source (yarn -s run publish-nightly -c | psub)
# source (node ./scripts/build-time -c | psub)
# source (yarn -s run sh:workspace-cli -c | psub)
# source (yarn -s run generate:snippets -c | psub)

source $cached_file
exec fish
