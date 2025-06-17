
# AUTHOR: ndonfris
#
# REPO: https://github.com/ndonfris/bends.fish
#
# WEB: https://github.com/ndonfris/bends.fish/blob/master/functions/up-or-prevd-or-backward-word.fish
#
# USAGE: `bind \ck up-or-prevd-or-backward-word`
#
# SUMMARY:
#   If the user's commandline pager (i.e., the completion/history menu) is open,
#   move up in the menu.
#
#   Otherwise, use the `commandline -f prevd-or-backward-word` builtin binding. If there
#   is no items in the stack, "$dirprev", and the commandline is empty, then
#   add the parent directory to the stack "$dirprev" (used by `prevd`).
#
# RELATED:
#    • `./down-or-nextd-or-foreward-word.fish` - file to perform opposite operations
#    • `man dirs` - directory stack
#    • `man prevd` && `echo $dirprev` - change directories to the previous directory in `dirs` stack
#    • `man commandline` - relevant info about editing commandline

function up-or-prevd-or-backward-word --description "if pager: up-line, else: prevd-or-backward-word"

    # Check that both the history pager and the completion pager are NOT visible. 
    # If neither are visible, then execute movement based operations
    if not commandline --paging-mode; and not commandline --search-mode

        # if there is no $dirprev in stack, add parent directory,  
        # ONLY when commandline is EMPTY
        if test $(count $dirprev) -eq 0  && test -z "$(commandline -b)" 
            set --append --global --export dirprev "$(path dirname $PWD)" 
        end

        # prevd is run when commandline is empty
        # backward-word is used when commandline has content
        commandline -f prevd-or-backward-word
        and return 0
       
    # pager is showing, so use the up-line commandline function
    else
        commandline -f up-line
        and return 0
    end 
end
