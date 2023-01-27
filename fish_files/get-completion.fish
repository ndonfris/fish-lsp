#!/usr/bin/fish

##
# File takes two arguments:
#       $argv[1] = '1' | '2' | '3'
#       $argv[2] =  string to be completed from the shell
#
##



function build_cmd --argument-names input
    set --local input_arr (string split --right --max 1 ' ' -- "$input")
    #switch "$input_arr[2]"
        ##case '-*'
            ##printf "complete --escape --do-complete '$input' | uniq | string match --regex --entire '^\-'"
        ##case ''
            ##string match -req '^\s?\$' -- "$input_arr[1]";
            ##printf "complete --escape --do-complete '$input' | uniq ";
            ##or printf "complete --escape --do-complete '$input -' | uniq | string match --regex --entire '^\-' && complete --escape --do-complete '$input ' | uniq";
        #case '*'
    #end
    printf "complete --escape --do-complete '$argv' | uniq"
end

# taken from my fish_config
function get-completions
    set --local cmd (build_cmd "$argv")
    eval $cmd
end

function get-subcommand-completions 
    set --local cmd (printf "complete --escape --do-complete '$argv ' | uniq")
    eval $cmd
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


