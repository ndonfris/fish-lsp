

# AUTHOR: ndonfris
#
# REPO: https://github.com/ndonfris/bends.fish
#
# WEB: https://github.com/ndonfris/bends.fish/blob/master/functions/down-or-nextd-or-forward-word.fish
#
# USAGE: `bind \cj down-or-nextd-or-foreward-word`
#
# SUMMARY:
#   If the user's commandline pager (i.e., the completion/history menu) is open,
#   move down in the menu.
#
#   Otherwise, use the `commandline -f nextd-or-foreward-word` builtin binding.
#
# RELATED:
#    • `./up-or-prevd-or-backward-word.fish` - file to perform opposite operations
#    • `man dirs` - directory stack
#    • `man nextd` && `echo $dirnext` - change directories to the next directory in `dirs` stack
#    • `man commandline` - relevant info about editing commandline

function down-or-nextd-or-forward-word -d "if in completion mode(pager), then move down, otherwise, nextd-or-forward-word"
    # if the pager is not visible, then execute the nextd-or-forward-word 
    # function
    if not commandline --paging-mode; and not commandline --search-mode
        commandline -f nextd-or-forward-word
        return
    # if the pager is visible, then move down one item
    else
        commandline -f down-line
        return
    end
end
