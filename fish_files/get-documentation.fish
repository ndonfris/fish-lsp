#!/usr/bin/env fish

## commands like mkdir or touch should reach this point 
function _flsp_get_command_without_manpage -d 'fallback for a command passed in without a manpage'
    set -l completions_docs (complete --do-complete="$argv -")
    if test -n "$completions_docs"
        echo -e "\t$argv Completions"
        echo $completions_docs[..10]
    else if test -n "$($argv --help 2>> /dev/null)"
        echo -e "\t$argv --help output"
        $argv --help 2>> /dev/null
    else
        echo ''
    end
end

function _flsp_get_manpage -d 'for a command with a manpage'
    man $argv | command col
end

set -l type_result (type -at "$argv[1]" 2> /dev/null)

switch "$type_result"
case "function"
    if type -f -q $argv 2>/dev/null
        _flsp_get_manpage $argv
    else
        functions --all $argv | tr -d '\b'
    end

case "builtin"
    __fish_print_help $argv 2>/dev/null | command cat
    return 0

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
