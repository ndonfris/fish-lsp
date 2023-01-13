#!/usr/bin/fish

## commands like mkdir or touch should reach this point 
function _flsp_get_command_without_manpage -d 'fallback for a command passed in without a manpage'
    set -l completions_docs (fish -c "complete --do-complete='$argv -'")
    #set -l cmd_hist (fish -c "history -p $argv -n 1")
    if test -n ($completions_docs)
        echo -e "\t$argv Completions"
        echo $completions_docs
    else if test -n ( echo ($argv --help 2>> /dev/null ) )
        echo "HISTORY FOR $argv"
        history -p $argv -n 10 --show-time
    else
        echo ''
    end
end

function _flsp_get_manpage -d 'for a command with a manpage'
    man $argv | sed -r 's/^ {7}/ /' | col -bx
end

set -l type_result (type -t "$argv[1]" 2> /dev/null)

switch "$type_result"
case "function"
    if type -f -q $argv 2>/dev/null
        _flsp_get_manpage $argv
    else
        functions --all $argv | col -bx 
    end

case "builtin"
    man $argv | sed -r 's/^ {7}/ /' | col -bx

case "file"
    set -l bad_manpage ( man -a $argv 2> /dev/null )
    
    if test -z "$bad_manpage" 
        echo ''
        return

    else if string match -rq "No manual entry for $argv" -- $bad_manpage
        _flsp_get_command_without_manpage $argv

    else 
        _flsp_get_manpage $argv
    end
case \*
    set -l bad_manpage ( man -a $argv 2> /dev/null )
    if test -z "$bad_manpage" 
        echo ''
        return 0
    else 
        _flsp_get_manpage $argv
        return 0
    end
end
