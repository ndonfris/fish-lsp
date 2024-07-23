#!/usr/bin/env fish

if not test -d $HOME/.config/fish/completions
  mkdir -p $HOME/.config/fish/completions 
end

fish-lsp complete > $HOME/.config/fish/completions/fish-lsp.fish