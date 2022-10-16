#!/usr/bin/fish 

# 
# this file prints the first 3 history commands matching the $argv 
# if $argv is empty then prints an empty string
#
# by default, the amount of history results to show is: 
#      set fish_lsp_cmp_history_amount 3 
#
# ^^^ note: global/universal variable above does not need to be edited
#          if user diables this feature in their lsp configurgation.
#

# outputs: 
#     # Sat 15 Oct 2022 08:02:26 PM CDT       cmd some_arg_1
#     # Fri 14 Oct 2022 11:52:39 AM CDT       cmd some_arg_2
#     # Fri 14 Oct 2022 04:55:31 AM CDT       cmd some_arg_3
#
# to access command and format, split output lines by \t
#


# private function called when cli arg is non-empty
function _get_fish_history_completions
    # set defualt value for completion history amount, then check if the user set it
    set -l amt 3
    if set -q fish_lsp_cmp_history_amount
        set amt $fish_lsp_cmp_history_amount
    end

    # create an array of matching history commands
    set -l h_arr (fish -c "history --max $amt -t -p '$argv' | col -bx | tr -s '\n' | paste - - 2>/dev/null")

    # store the size of $h_arr for index in size loop below
    set -l h_sz (count $h_arr)

    if test $h_sz -ge 1
        for i in (seq 1 $h_sz)
            printf '%s\n' $h_arr[$i]
        end
    else 
        printf '\n'
    end
end



# call function if argv is a non-empty
if test -n "$argv" 
    _get_fish_history_completions $argv
else 
    printf '\n'
end


