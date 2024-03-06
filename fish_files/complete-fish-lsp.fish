complete -c fish-lsp -f

function _fish_lsp_subcmd_names
    fish-lsp complete --names
end

complete -c fish-lsp -n '__fish_use_subcommand' -a '(_fish_lsp_subcmd_names)' 

set __fish_lsp_subcommands bare min start

complete -c fish-lsp -n '__fish_seen_subcommand_from $__fish_lsp_subcommands' -a '--show\tdump\ output\ and\ stop\ server\n
                                                                --enable\tenable\ feature\n
                                                                --disable\tdisable\ feature\n'
complete -c fish-lsp -n '__fish_seen_subcommand_from startup-configuration' -a '--json\tshow\ as\ json\n
                                                                               --lua\tshow\ as\ lua\n'
complete -c fish-lsp -n '__fish_seen_subcommand_from show-path' -a '--bin\tshow\ bin\n
                                                                    --repo\tshow\ repo\n'

complete -c fish-lsp -n '__fish_seen_subcommand_from complete' -a "
    --names\t'show the feature names of the completions'
    --toggles\t'show the feature names of the completions'
    --fish\t'show the fish-completions file'
    --features\t'show the features'"

# Dynamic completion for the --disable option after "start" subcommand
function _fish_lsp_get_features
    fish-lsp complete --features
end

complete -c fish-lsp -n '__fish_seen_subcommand_from $__fish_lsp_subcommands' -l disable -xa '(_fish_lsp_get_features)'
complete -c fish-lsp -n '__fish_seen_subcommand_from $__fish_lsp_subcommands' -l enable -xa '(_fish_lsp_get_features)'