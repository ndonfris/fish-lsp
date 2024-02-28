
# completions for fish-lsp
function __default_cmps
    echo -e "start\tstart the fish-lsp server\n" \
    "complete\tview completions for fish-lsp\n"  \
    "capabilities\tlist capabilities for fish-lsp\n" \
    "report\treport an issue on fish-lsp\n" \
    "show-path\tpath of fish-lsp\n"
end



complete -c fish-lsp -n '__fish_use_subcommand' -a '(__default_cmps)'
complete -c fish-lsp -s h -l help -d 'show help'
complete -c fish-lsp -s v -l version -d 'show version'
complete -c fish-lsp -s o -l startup-options -d 'provide JSON startup options'
complete -c fish-lsp -l lsp-version -d 'show lsp-version'
complete -c  fish-lsp -s t -l time -d 'time startup of path' --wraps __fish_complete_directories 