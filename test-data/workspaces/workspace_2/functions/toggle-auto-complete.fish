
# https://github.com/ndonfris/bends.fish

function toggle-auto-complete -d 'accept current completion or open completion menu'
    argparse 'a/accept' 'r/reject' h/help -- $argv
    or return

    if set -q _flag_help
         __toggle-auto-complete-help-msg
        return 0
    end


    # pager is open: accept/reject -> close pager
    if commandline --paging-mode; or commandline --search-mode
        # reject mode seen, supress the current autosuggestion
         set -q _flag_reject && commandline -f suppress-autosuggestion

        # accept-autosuggestion, which closes the pager
        commandline -f accept-autosuggestion
       
    # pager is not open: show pager or try completion
    else
        commandline -f complete
    end
end


function __toggle-auto-complete-help-msg
    echo -e \
    'toggle-auto-complete: bends.fish toggle-auto-complete function

    OPTIONS:
        -a,--accept\taccept pager selected tokens
        -r,--reject\treject pager selected tokens
        -h,--help\tshow this message

    USAGE:
        # default accepts current commandline pager selection
        >_ bind -k nul \'toggle-auto-complete\'
        >_ bind -k nul \'toggle-auto-complete --accept\'

        # reject autosuggestion selected tokens
        >_ bind -k nul \'toggle-auto-complete --reject\' 

        # using bends
        >_ bends -k nul \'toggle-auto-complete --reject\'

    MORE:
        • https://github.com/ndonfris/bends.fish
        • https://github.com/ndonfris/bends.fish/blob/master/functions/toggle-auto-complete.fish
        • https://github.com/ndonfris/bends.fish/blob/master/completions/toggle-auto-complete.fish
        • https://github.com/ndonfris/bends.fish/blob/master/functions/history-search-or-toggle-auto-complete.fish
        • https://github.com/ndonfris/bends.fish/blob/master/functions/fzf-or-toggle-auto-complete.fish
    '
end
