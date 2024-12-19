#!/usr/bin/env fish

# The below if statement is only included because of possible CI/CD edge-cases.
# For almost all users, this should not do anything.
if not test -d $HOME/.config/fish/completions
  mkdir -p $HOME/.config/fish/completions 
  if not contains -- $HOME/.config/fish/completions $fish_complete_path
    set --append --global --export fish_complete_path $HOME/.config/fish/completions $fish_complete_path
  end
end

./bin/fish-lsp complete > $fish_complete_path[1]/fish-lsp.fish