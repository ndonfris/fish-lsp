#!/usr/bin/env fish

# https://github.com/alacritty/alacritty/blob/master/INSTALL.md#fish 
set -l complete_dir "$fish_complete_path[1]"
if not test -d "$complete_dir"
  mkdir -p $complete_dir
end
fish-lsp complete > $complete_dir/fish-lsp.fish