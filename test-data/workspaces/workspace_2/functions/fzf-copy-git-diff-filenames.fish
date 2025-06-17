# Iterative bind function
#
# Test with: `bind \ecg fzf-copy-git-diff-filenames` 
#
# Uses fzf to select multiple modified files (USEFUL FOR COMMIT MESSAGES) 
function fzf-copy-git-diff-filenames --description "fzf copies modified repo files without editing prompt"
    
    # Store a result ARRAY of modified filenames, which might be EMPTY
    set -l result (__fzf-copy-git-diff-helper)

    # No result files, exit early
    if test $(count $result) -eq 0
        commandline -f repaint
        and return 0
    end

    # Use the result files, that we now know exists.  
    keep-current-commandline-and-fish-clipboard-copy (string join -n ' ' "$result" | string collect)
    commandline -f repaint
    and return 0
end

#
# Print output files that have been selected from fzf
#
# OUTPUT: 
#     file1
#     file2
#     file3
function __fzf-copy-git-diff-helper --description 'helper to output fzf result'
    git diff --name-status origin/$(git rev-parse --abbrev-ref HEAD) \
    | fzf --nth 2 --multi --cycle --keep-right --filepath-word \
          --bind 'tab:toggle,btab:toggle+up,enter:select+accept' \
    | string split \n -n \
    | string split \t -m1 -f2
end
