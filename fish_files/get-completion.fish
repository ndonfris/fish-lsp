#!/usr/bin/env fish

##
# File takes two arguments:
#       $argv[1] = '1' | '2' | '3'
#       $argv[2] =  string to be completed from the shell
#
# $argv[2] can be text from a document: it is only ever the value of
# `--do-complete`, never pasted into code that gets `eval`'d.
##

function get-completions
    complete --escape --do-complete="$argv" | uniq
end

function get-subcommand-completions
    complete --escape --do-complete="$argv " | uniq
end

function get-variable-completions
    if contains $argv (set -n)
        set --show $argv
    end
end

switch "$argv[1]"
    case '1'
        get-completions "$argv[2..]"
    case '2'
        get-subcommand-completions "$argv[2..]"
    case '3'
        get-variable-completions "$argv[2..]"
    case '*'
        get-completions "$argv"
end


