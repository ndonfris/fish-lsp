# https://github.com/ndonfris/bends.fish

function keep-current-commandline-and-fish-clipboard-copy --description 'copy $argv without overwriting commandline'
    set -l current (commandline -b) # in future, support resetting the cursor location too
    set -l to_copy "$argv"

    if test -z "$to_copy"
        return
    end

    # replace commandline with argument passed in
    commandline -r "$to_copy" && fish_clipboard_copy

    # reset initial commandline text 
    commandline -r "$current" && commandline -f repaint
end

