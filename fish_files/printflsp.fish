#!/usr/bin/env fish

function inner_printer
#if set -q (eval $argv)
#eval $argv 2>/dev/null
    eval $argv
    if test $status -ne 0
        return 0
    end
end

inner_printer $argv


#set status 0