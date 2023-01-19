#!/usr/bin/fish

function build_cmd --argument-names input
    set --local input_arr (string split --right --max 1 ' ' -- "$input")
    #set -l last_word (string split --right --max 1 --fields 2 ' ' -- "$input")
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

# from my fish functions
function get-completions
    set --local last_word (string split --right --max 1 --fields 2 ' ' -- "$argv")
    set --local input_str (string escape -n --style=script "$argv")
    set --local cmd (build_cmd "$argv")
    #switch "$last_word"
    #case '-*'
    #set cmd complete --escape --do-complete "$input_str" \| uniq \| string match --regex --entire '^\-';
    ##case ''
    ##set cmd complete --escape --do-complete "$input_str\ \-" \| uniq \| string match --regex --entire '^\-';
    #case '**'
    #set cmd complete --escape --do-complete "$input_str" \| uniq;
    #end
    eval $cmd
end



#test_lastword "$argv"
get-completions "$argv"
