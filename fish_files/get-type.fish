#!/usr/bin/fish

# command - shown using man
# file - shown using functions query
set -l type_result (type -t "$argv" 2> /dev/null)

switch "$type_result"
case "function"
    if type -f -q $argv 2> /dev/null
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
