# Here we test if fish-lsp is erroring out when reading this workspace
# since it contains a folder that is not readable by the current user

function create_unreadable_folder -d 'helper so we don\'t have to ship root privilege folder'
    mkdir unreadable_folder
    touch unreadable_folder/readable_file.fish
    chmod 000 unreadable_folder/readable_file.fish
    chmod 000 unreadable_folder
    return $status
end

function remove_unreadable_folder -d 'helper to remove the unreadable folder'
    if test -d unreadable_folder  && test -r unreadable_folder
        rm -ri unreadable_folder/
        return $status
    else if test -d unreadable_folder
        echo "Removing folder requires root privilege" >&2
        echo "You can run 'sudo rm -rf unreadable_folder/' or 'sudo fish file.fish --remove'" >&2
        return 1
    end
    echo "folder 'unreadable_folder/' does not exist" >&2
    return 1
end


argparse remove create h/help -- $argv
or return

if set -q _flag_help
    echo "file.fish [OPTIONS]"
    echo ""
    echo "This file is used to test if fish-lsp is erroring out when reading this workspace"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help      Show this message"
    echo "      --create    Create a folder that is not readable by the current user"
    ehco "      --remove    Remove the folder that is not readable by the current user"
    echo ""
    echo "USAGE:"
    echo "  >_ fish file.fish --create"
    echo "  >_ fish-lsp info --time-startup --no-warning --use-workspace ."
    return 0
end

if set -q _flag_create
    create_unreadable_folder
    echo "Created unreadable_folder"
    return 0
end

if set -q _flag_remove
    remove_unreadable_folder
    return $status
end


echo "This is a normal file"
echo "You can run 'fish file.fish --create-unreadable' to create a folder that is not readable by the current user"

