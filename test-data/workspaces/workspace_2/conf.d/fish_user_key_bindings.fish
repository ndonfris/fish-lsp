
function fish_user_key_bindings --description 'User-defined key bindings for Fish shell'
    bind ctrl-o,ctrl-f fzf-history-search
    bind ctrl-o,ctrl-r 'fzf-history-search --replace'
    bind ctrl-o,ctrl-g,ctrl-y 'fzf-copy-git-diff-filenames'
    bind ctrl-o,ctrl-g,ctrl-v 'copy-git-diff-filenames'
    bind ctrl-o,ctrl-l pushd-all-in-path

    bind ctrl-j down-or-nextd-or-forward-word
    bind ctrl-k up-or-prevd-or-backward-word
    bind ctrl-space toggle-auto-complete
  

    if test "$OS_NAME" = 'darwin'
        bind ctrl-down down-or-nextd-or-forward-word
        bind ctrl-up up-or-prevd-or-backward-word
    end
end

abbr -a fukb fish_user_key_bindings
