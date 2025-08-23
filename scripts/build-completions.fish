#!/usr/bin/env fish

source ./scripts/pretty-print.fish
source ./scripts/get-binary-file.fish

# The below if statement is only included because of possible CI/CD edge-cases.
# For almost all users, this should not do anything.
if not test -d $HOME/.config/fish/completions
    mkdir -p $HOME/.config/fish/completions
    if not contains -- $HOME/.config/fish/completions $fish_complete_path
        set --append --global --export fish_complete_path $HOME/.config/fish/completions $fish_complete_path
    end
end

argparse h/help s/source -- $argv
or return

if set -q _flag_help
    echo 'NAME:'
    echo '   build-completions.fish'
    echo ''
    echo 'DESCRIPTION:'
    echo '   Generate completions for fish-lsp.'
    echo ''
    echo 'OPTIONS:'
    echo -e '   -s,--source\terase shell\'s completions and source current fish-lsp completions'
    echo -e '   -h,--help\tshow this message'
    echo ''
    echo 'EXAMPLES:'
    echo -e '  >_ ./build-completions.fish '
    echo -e '  no args will overwrite the $fish_complete_path[1]/fish-lsp.fish file with the current completions'
    echo -e ''
    echo -e '  >_ ./build-completions.fish -s'
    echo -e '  erase the current completions and source the new completions from the current fish-lsp'
    echo -e '  this will not overwrite the $fish_complete_path[1]/fish-lsp.fish file'
    return 0
end

if set -q _flag_source
    complete -c fish-lsp -e
    complete -e fish-lsp
    $pkg_json_bin complete | source
    # ./bin/fish-lsp complete | source
    and print_success "Generated completions for fish-lsp in $BLUE'$fish_complete_path[1]/fish-lsp.fish'"
    or print_failure "Failed to generate completions for fish-lsp in $BLUE'$fish_complete_path[1]/fish-lsp.fish'"
    return 0
end

# ./bin/fish-lsp complete > $fish_complete_path[1]/fish-lsp.fish
$pkg_json_bin complete >$fish_complete_path[1]/fish-lsp.fish
and print_success "Generated completions for fish-lsp in $BLUE'$fish_complete_path[1]/fish-lsp.fish'"
or print_failure "Failed to generate completions for fish-lsp in $BLUE'$fish_complete_path[1]/fish-lsp.fish'"
