#!/usr/bin/env fish

argparse --stop-nonopt f/function c/completion m/max=+ -- $argv
or return 

set cmd_name (string split ' ' --max 1 --fields 1 --no-empty -- $argv)
if test -z "$cmd_name"
    return 0
end

set -ql _flag_max
and set max_results $_flag_max
or set max_results 100

if set -ql _flag_function
    path filter -f -- $fish_function_path/$cmd_name.fish 2>/dev/null | head -n $max_results
    return 0
end

if set -ql _flag_completion
    path filter -f -- $fish_complete_path/$cmd_name.fish 2>/dev/null | head -n $max_results
    return 0
end

