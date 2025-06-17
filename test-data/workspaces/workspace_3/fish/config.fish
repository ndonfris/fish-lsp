## global variables,
set -gx EDITOR nvim
set -gx VISUAL nvim
set -gx OS_NAME (os-name)

## PROMPT
function fish_prompt
    set_color green
    echo -n "$(whoami)@$(hostname) on $(os-name) ||| "
    set_color normal

    set_color blue --underline
    echo -n "$(pwd)"
    set_color normal

    set_color magenta --bold
    echo -n " ><(((°>"
    set_color normal
end

## PATHS
fish_add_path --global ~/.local/bin
fish_add_path --global /usr/local/bin
fish_add_path --global /usr/bin
fish_add_path --global /bin
fish_add_path --global /usr/sbin
fish_add_path --global ~/.config/fish/bin
fish_add_path --global $HOME/.cargo/env
fish_add_path --global $HOME/.npm/bin

## ALIASES
# @fish-lsp-disable 2002
alias ll="ls -l"
alias la="ls -a"
alias lcf="ls -CF"
alias sl=ls
# @fish-lsp-enable 2002

## Use keybindings
fish_user_key_bindings
