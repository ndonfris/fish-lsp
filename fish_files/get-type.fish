#!/usr/bin/env fish

function get_type --argument-names str
    set -l type_result (type -t "$str" 2> /dev/null)
    switch "$type_result"
    case "function"
        # Keep legacy behavior for `export`, but classify all other functions as `file`
        # so hover renders function source as fish code instead of man-format docs.
        if contains -- $str export || builtin -q -- $str
            echo 'command'
        else
            echo 'file'
        end
    case "builtin"
        echo 'command'
    case "file"
        echo 'command'
    case \*
        echo ''
    end
end

# command - shown using man
# file - shown using functions query

set -l first (string split -f 1 '-' -- "$argv")

set -l normal_output (get_type "$argv")
set -l fallback_output (get_type "$first")

if test -n "$normal_output"
    echo "$normal_output"
else if test -n "$fallback_output"
    echo "$fallback_output"
else
    echo ''
end
