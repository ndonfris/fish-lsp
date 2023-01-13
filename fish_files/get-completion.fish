#!/usr/bin/fish

# from my fish functions 
function get-completions
    set -l s (string escape -n --style=script "$argv")
    set cmd complete --do-complete="$s" 
    eval $cmd
end


get-completions "$argv"
