#!/usr/bin/fish

function build_cmd --argument-names input
    set --local input_arr (string split --right --max 1 ' ' -- "$input")
    switch "$input_arr[2]"
        case '-*'
            printf "complete --escape --do-complete '$input' | uniq | string match --regex --entire '^\-'"
        case ''
            string match -req '^\s?\$' -- "$input_arr[1]"; 
            and printf "complete --escape --do-complete '$input' | uniq ";
            or printf "complete --escape --do-complete '$input -' | uniq | string match --regex --entire '^\-'";
        case '*'
            printf "complete --escape --do-complete '$input' | uniq"
    end
end

# taken from my fish_config
function get-completions
    set --local cmd (build_cmd "$argv")
    eval $cmd
end



get-completions "$argv"
