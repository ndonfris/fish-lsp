
# ┌─────────────┐
# │ touch utils │
# └─────────────┘
# functions:
#  - `touchx`                     (touch executable)
#  - `touchd`                     (touch directory)
#  - `__touch_shebang_conversion` (internal utility function)
#
# completions are also provided for both functions



#
# touchx -- Create a file and make it executable
#
function touchx --description 'Create a file and make it executable' --wraps touch

    function __help_msg --description 'Show help message for touchx'
        echo 'USAGE: touchx [OPTIONS] <file>'
        echo '  Create a file and make it executable'
        echo ''
        echo 'OPTIONS:'
        echo '  -h, --help        show help message'
        echo '  -c, --copy        Copy the file to the clipboard after creating it'
        echo '      --shebang     Add a shebang to the file'
        echo ''
        echo 'SEE ALSO:'
        echo '   `touchd` - Create a file and handle creating directories'
        echo '   ~/.config/fish/conf.d/touch.fish'
    end

    if test -z "$argv"
        __help_msg
        return 1
    end

    argparse --ignore-unknown --stop-nonopt h/help c/copy shebang= -- $argv
    or return

    if set -q _flag_help
        __help_msg
        return 0
    end

    touch $argv
    or echo "ERROR: `touchx` failed to create file: '$argv'" && return 1


    chmod +x $argv
    or echo "ERROR: `touchx` failed to make file executable: '$argv'" && return 1

    if set -q _flag_shebang
        echo "$(__touch_shebang_conversion $_flag_shebang)" > $argv
        or echo "ERROR: `touchd` failed to add shebang to file: '$argv'" && return 1
    end

    if set -q _flag_copy
        echo -n $argv | fish_clipboard_copy
    end

end
complete -c touchx -s h -l help    -d 'Show help message'
complete -c touchx -s c -l copy    -d 'Copy the file to the clipboard after creating it'
complete -c touchx      -l shebang -d 'Add a shebang to the file' --keep-order -xa 'env\t!#/usr/bin/env
envfish\t"!#/usr/bin/env fish"
envpython\t"!#/usr/bin/env python"
envpython3\t"!#/usr/bin/env python3"
envbash\t"!#/usr/bin/env bash"
envsh\t"!#/usr/bin/env sh"
binfish\t"!#/bin/fish"
binbash\t"!#/bin/bash"
binsh\t"!#/bin/sh"
ubinbash\t"!#/usr/bin/bash"
ubinsh\t"!#/usr/bin/sh"
ubinpython\t"!#/usr/bin/python"
ubinfish\t"!#/usr/bin/fish"
ulbinbash\t"!#/usr/local/bin/bash"
ulbinsh\t"!#/usr/local/bin/sh"
ulbinpython\t"!#/usr/local/bin/python"
ulbinfish\t"!#/usr/local/bin/fish"'


#
# touchd -- file creation with directory support
# 
function touchd --description 'Create a file and handle creating directories'

    # reusable help message for touchd
    function __help_msg --description 'Show help message for touchd'
        echo 'USAGE: touchd [OPTIONS] <directory>/<file>'
        echo '   Create a file and handle creating directories'
        echo ''
        echo 'OPTIONS:'
        echo '  -c, --copy        Copy the file to the clipboard after creating it'
        echo '  -x, --executable  Make the file executable'
        echo '      --shebang     Add a shebang to the file'
        echo '  -h, --help        show help message'
        echo ''
        echo 'SEE ALSO:'
        echo '   `touchx` - create a file and make it executable (doesn\'t handle directories)'
        echo '   ~/.config/fish/conf.d/touch.fish'
    end


    # if touchd is called without arguments, show help message
    if test -z "$argv"
        __help_msg
        return 1
    end

    argparse --ignore-unknown --stop-nonopt h/help x/executable c/copy shebang= -- $argv
    or return

    # if help flag is set, show help message
    if set -q _flag_help
        __help_msg
        return 0
    end

    # get the directory name from the argument
    set -l dir (path dirname -- $argv)

    # if the directory is not the current directory, create it
    if test "$dir" != "."
        mkdir -p $dir 
        or echo "ERROR: `touchd` failed to create directory: '$dir'" && return 1
    end

    # create the file
    touch $argv
    or echo "ERROR: `touchd` failed to create file: '$argv'" && return 1


    # if executable flag is set, make the file executable
    if set -q _flag_executable
        chmod +x $argv
        or echo "ERROR: `touchd` failed to make file executable: '$argv'" && return 1

    end

    if set -q _flag_shebang
        echo "$(__touch_shebang_conversion $_flag_shebang)" > $argv
        or echo "ERROR: `touchd` failed to add shebang to file: '$argv'" && return 1
    end

    # copy the file to the clipboard if the copy flag is set
    if set -q _flag_copy
        echo -n $argv | fish_clipboard_copy
    end
end

complete -c touchd -s h -l help -d 'Show help message'
complete -c touchd -s x -l executable -d 'Make the file executable'
complete -c touchd -s c -l copy -d 'Copy the file to the clipboard after creating it'
complete -c touchd      -l shebang -d 'Add a shebang to the file' --keep-order -xa 'env\t!#/usr/bin/env
envfish\t"!#/usr/bin/env fish"
envpython\t"!#/usr/bin/env python"
envpython3\t"!#/usr/bin/env python3"
envbash\t"!#/usr/bin/env bash"
envsh\t"!#/usr/bin/env sh"
binfish\t"!#/bin/fish"
binbash\t"!#/bin/bash"
binsh\t"!#/bin/sh"
ubinbash\t"!#/usr/bin/bash"
ubinsh\t"!#/usr/bin/sh"
ubinpython\t"!#/usr/bin/python"
ubinfish\t"!#/usr/bin/fish"
ulbinbash\t"!#/usr/local/bin/bash"
ulbinsh\t"!#/usr/local/bin/sh"
ulbinpython\t"!#/usr/local/bin/python"
ulbinfish\t"!#/usr/local/bin/fish"'

function __touch_shebang_conversion --description '`touchx`/`touchd` util to convert a shebang argument to a shebang line'
    switch $argv
        case env
            echo "#!/usr/bin/env"
        case envfish
            echo "#!/usr/bin/env fish"
        case envpython
            echo "#!/usr/bin/env python"
        case envpython3
            echo "#!/usr/bin/env python3"
        case envbash
            echo "#!/usr/bin/env bash"
        case envsh
            echo "#!/usr/bin/env sh"
        case binfish
            echo "#!/bin/fish"
        case binbash
            echo "#!/bin/bash"
        case binsh
            echo "#!/bin/sh"
        case ubinbash
            echo "#!/usr/bin/bash"
        case ubinsh
            echo "#!/usr/bin/sh"
        case ubinpython
            echo "#!/usr/bin/python"
        case ubinfish
            echo "#!/usr/bin/fish"
        case ulbinbash
            echo "#!/usr/local/bin/bash"
        case ulbinsh
            echo "#!/usr/local/bin/sh"
        case ulbinpython
            echo "#!/usr/local/bin/python"
        case ulbinfish
            echo "#!/usr/local/bin/fish"
        case '*'
            echo $argv
    end
end
