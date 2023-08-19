


set -gx PATH $HOME/.cargo/bin $PATH



function fish_user_key_bindings
    bind \cH 'backward-kill-word' 
end

abbr -a -g nrt 'npm run test'
set -gx EDITOR 'nvim'
set -gx VISUAL 'nvim'