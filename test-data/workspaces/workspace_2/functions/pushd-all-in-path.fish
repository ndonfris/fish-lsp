# https://github.com/ndonfris/bends.fish

# cdh and dirs are controlled by variables "$dirprev" and "$dirnext", and directly use
# variable "$dirstack" to store the stack of directories.
# $dirstack is an array where index 0 is the top of the stack.
function pushd-all-in-path --description "push all parent directories to \$dirprev"
    set -l curr_dirs
    set -l dirpath_array (string split '/' --no-empty "$PWD" || echo '') # arary of dirs in $PWD -> ["home", "user", "dir1", "dir2"] 
    for new_dir in $dirpath_array
        set --append  curr_dirs (string join '/' -- "$curr_dirs[-1]" "$new_dir")
        if not test -d "$curr_dirs[-1]"
            echo "[ERROR] pushd_all_in_path could not find '$existing_dir'"
            return 1
        end
    end
    if not test (count $dirpath_array) -eq 0
        set --prepend curr_dirs '/' # add root since path is correct
    end
    for existing_dir in $curr_dirs
        pushd "$existing_dir"
    end
    commandline -f repaint
    return 0
end
