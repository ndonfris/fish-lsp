#!/usr/bin/fish

## commands like mkdir or touch should reach this point 
function _flsp_get_command_without_manpage -d 'fallback for a command passed in without a manpage'
    if test -n ( echo ($argv -h 2>> /dev/null) )
        $argv -h 
    else if test -n ( echo ($argv --help 2>> /dev/null ) )
        $argv --help
    else
        echo ''
    end
end

function _flsp_get_manpage -d 'for a command with a manpage'
    man $argv | sed -r 's/^ {7}/ /' | col -bx
end


set -l type_result (type -t "$argv" 2> /dev/null)

switch "$type_result"
case "function"
    if type -f -q $argv 2>/dev/null
        _flsp_get_manpage
    else
        functions --all $argv | col -bx 
    end

case "builtin"
    man $argv | sed -r 's/^ {7}/ /' | col -bx

case "file"
    set -l bad_manpage ( man -a $argv 2>&1 )
    
    if test -z "$bad_manpage" 
        echo ''
        return

    else if string match -rq "No manual entry for $argv"
        _flsp_get_command_without_manpage $argv

    else 
        _flsp_get_manpage $argv
    end
    
case \*
    echo ''
end

