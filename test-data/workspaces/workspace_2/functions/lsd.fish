function lsd --wraps='exa --icons --color=always -a --group-directories-first' --description 'alias lsd=exa --icons --color=always -a --group-directories-first'
  exa --icons --color=always -a --group-directories-first $argv
end
