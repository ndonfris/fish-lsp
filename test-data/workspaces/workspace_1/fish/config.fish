set -gx PATH $HOME/.cargo/bin $PATH

function fish_user_key_bindings
    bind \cH backward-kill-word
    if os-name --is-mac
        bind ctrl-down down-line
        bind ctrl-up up-line
    else if os-name --is-linux
        bind ctrl-down down-line
        bind ctrl-up up-line
        bind ctrl-space complete
    end
end

abbr -a -g nrt 'npm run test'
set -gx EDITOR nvim
set -gx VISUAL nvim

