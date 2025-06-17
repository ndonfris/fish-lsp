# @fish-lsp-disable 3003

### AUTHOR: @ndonfris
### 
### FILES: 
### 
###    • $__fish_user_data_dir/{functions,completions}/os-name.fish
###    • ~/.config/fish/functions/os-name.fish
###    • ~/.config/fish/completions/os-name.fish
### 
### DESCRIPTION:
### 
###    A function that can either be used to check if the current
###    operating system is macOS, Linux, Windows, or Unix-like. Or,
###    it can be used to set a variable `OS_NAME` with the detected OS
###    name as its value. 
###    
###    Allows for syntactic sugar for checking the OS inside fish
###    functions/scripts, by easily allowing the user to call this
###    function as the CONDITIONAL STATEMENT in any `if <STATEMENT>`.
### 
###    Comes with built-in completions, and a help message.
###
###    TLDR; this is a wrapper around `uname -s` that makes handling OS
###    specific logic in fish scripts easier and more readable.
### 
### EXAMPLE USAGE:
###    
###    • Two equivalent ways to store the OS name in a variable:
###
###       >_ set -gx OS_NAME (os-name)
###       >_ os-name --global --export
###
###    • Check if the current OS is macOS:
### 
###       >_ if os-name --is-mac
###       >_     echo "Running on macOS"
###       >_ end
### 
###    • Handle different OSes in a script: 
###      
###       >_ if os-name --is-mac
###       >_     echo "This is macOS"
###       >_ else if os-name --is-linux
###       >_     echo "This is Linux"
###       >_ else if os-name --is-windows
###       >_     echo "This is Windows"
###       >_ else if os-name --is-unix
###       >_     echo "This is a Unix-like OS"
###       >_ else
###       >_     echo "Unknown OS"
###       >_ end
###
###    • Use a switch statement for more complex logic:
###
###       >_ switch "$(os-name)"
###       >_     case "mac"
###       >_         echo "This is macOS"
###       >_     case "linux"
###       >_         echo "This is Linux"
###       >_     case "win"
###       >_         echo "This is Windows"
###       >_     case "unknown"
###       >_         echo "Unknown OS"
###       >_     case "*"
###       >_         echo "This is some other OS"
###       >_ end
###
###    • Conditional execution based on the OS:
### 
###       >_ os-name --is-mac && echo "Running on macOS"
###       >_ or os-name --is-linux && echo "Running on Linux"
###       >_ or os-name --is-windows && echo "Running on Windows"
###

function os-name --description "Detect operating system, or set it to a variable"

    # Arrays of all the possible flags that can be set from the argparse command
    set -l all_os_check_flags _flag_is_mac _flag_is_linux _flag_is_windows _flag_is_win _flag_is_unix
    set -l all_set_flags _flag_global _flag_universal _flag_export _flag_local _flag_dry_run _flag_set

    # Arrays that will hold the flags that were set by the user
    set -l os_check_flags
    set -l set_flags

    # Parse the command line arguments using argparse
    argparse \
        --exclusive is-mac,is-linux,is-windows,is-win,is-unix \
        --exclusive g,U,l \
        --exclusive set,dry-run \
        h/help \
        is-mac is-linux is-windows is-win is-unix \
        g/global U/universal x/export l/local dry-run set -- $argv
    or return 1

    # Check if any of the os_check flags have been passed into the function
    for flag in $all_os_check_flags
        if set -q $flag
            set -a os_check_flags $flag
        end
    end
    # Check if any of the set flags have been passed into the function
    for flag in $all_set_flags
        if set -q $flag
            set -a set_flags $flag
        end
    end

    # If both types of use cases for this function are used, we will throw an error
    if test -n "$os_check_flags" && test -n "$set_flags"
        echo "$(set_color red --bold --italic --underline)Error$(set_color normal && set_color red): invalid usage, cannot use any OS status flag in conjunction with set variable flags.$(set_color normal)" >&2 
        echo '' >&2
        echo "$(set_color normal)For help run:$(set_color normal&&set_color $fish_color_command) os-name --help" >&2
        set_color normal
        return 1
    end

    # If the help flag is set, we will print the help message and exit
    if set -q _flag_help
        echo "USAGE: os-name [OPTIONS]"
        echo
        echo "  Detect the current operating system or store it in a env variable."
        echo
        echo 'SYNOPSIS:'
        echo "   os-name "
        echo "   os-name [--is-mac | --is-linux | --is-windows | --is-win | --is-unix]"
        echo "   os-name [--global | --universal | --export | --local] [--set | --dry-run]"
        echo "   os-name [-h | --help]"
        echo
        echo "DESCRIPTION:"
        echo "   When no options are given, returns lowercase OS name: linux, mac, win, or unknown."
        echo "   When any set flag is provided, sets the variable os_name with the detected OS name."
        echo "   The variable can be set globally, universally, locally, or exported to child processes."
        echo "   The variable will be named `\$OS_NAME`, and its value will be the lowercase name of the OS."
        echo 
        echo "OPTIONS:"
        echo "   -h, --help      Show this help message"
        echo "   --is-mac        Return 0 if macOS, 1 otherwise"
        echo "   --is-linux      Return 0 if Linux, 1 otherwise"
        echo "   --is-windows    Return 0 if Windows, 1 otherwise"
        echo "   --is-win        Alias for --is-windows"
        echo "   --is-unix       Return 0 if Unix-like OS, 1 otherwise"
        echo "   --set           Set the variable \$OS_NAME with the detected OS name"
        echo "   --dry-run       Show the command that would be executed when setting the variable"
        echo "   -g, --global    Set variable globally"
        echo "   -U, --universal Set variable universally (in all sessions)" 
        echo "   -x, --export    Export variable to child processes"
        echo "   -l, --local     Set variable locally"
        echo 
        echo ' ┌───────────────────────────────────────────────────────────────────────────┐ '
        echo ' │ NOTE: `--is-*` flags cannot be used in conjunction with any `--set` flags │ '
        echo ' └───────────────────────────────────────────────────────────────────────────┘ '
        echo 
        echo "EXAMPLES:"
        echo "   >_ os-name --is-mac"
        echo '   Returns 0 (true) if macOS, otherwise returns 1 (false).'
        echo 
        echo "   >_ if os-name --is-linux; echo 'Running on Linux'; end"
        echo '   Prints "Running on Linux" if the OS is Linux, otherwise does nothing.'
        echo '   This is useful for conditional execution based on the OS.'
        echo 
        echo "   >_ os-name --global --export "
        echo "   Sets the variable global variable '\$OS_NAME' for your current shell session."
        echo 
        echo "   >_ os-name --dry-run --global --export"
        echo "   Shows the command that would be executed to set the variable '\$OS_NAME'."
        echo 
        echo "   >_ os-name"
        echo "   Prints the lowercase name of the current operating system."
        echo "   Possible values include: `linux`, `mac`, `win`, or `unknown`."
        return 0
    end

    set -l os_name (__get_os_name_util)
    
    # Check for macOS
    if set -q _flag_is_mac
        test "$os_name" = "mac"
        return $status
    end
    
    # Check for Linux
    if set -q _flag_is_linux
        test "$os_name" = "linux"
        return $status
    end
    
    # Check for Windows subsystems or native Windows
    if set -q _flag_is_windows || set -q _flag_is_win
        test "$os_name" = "win"
        return $status
    end

    # Unix-like systems (Linux, macOS, BSDs, etc.)
    if set -q _flag_is_unix
        switch "$(uname -s)"
        case "Linux" "Darwin" "*BSD" "SunOS" "AIX" "HP-UX"
            return 0
        case "*"
            return 1
        end
    end

    # NOTE: THIS IS THE DEFAULT BEHAVIOR! 
    #       We don't need to check for status flags here because we already checked for them above.
    #       If there isn't any status flags, and there isn't any set flags, we
    #       just print the OS name, and stop execution here. 
    test -z "$set_flags"
    and echo $os_name
    and return 0

    # BUILD THE COMMAND FOR SETTING THE `$OS_NAME` VARIABLE

    # We will store the scope/export flags in the array defined below
    set -l scope_flags

    set -q _flag_global
    and set -a scope_flags '--global'
    
    set -q _flag_local
    and set -a scope_flags '--local'

    set -q _flag_universal
    and set -a scope_flags '--universal'
    
    set -q _flag_export
    and set -a scope_flags '--export'
    
    # if the --dry-run flag is set, we will not execute the command, but print it instead
    set -q _flag_dry_run
    and __get_os_name_print_dry_run_colored
    and return 0

    # If we reach here, we set the variable with the detected OS name, in the current session.
    set cmd "$(string join --no-empty ' ' -- set $scope_flags OS_NAME \'$os_name\')"
    eval $cmd
end

# Utility function to detect the OS name
# Always outputs one of the following: 'mac', 'linux', 'win', or 'unknown'
function __get_os_name_util --description 'print $(uname -s) lowercase shorthand: "mac", "linux", "win", "unknown"'
    # Detect OS based on uname
    set -l os_type (uname -s)

    # Default behavior: return OS name
    switch $os_type
        case "Darwin"
            echo "mac"
        case "Linux"
            echo "linux" 
        case "*NT*" "CYGWIN*" "MINGW*"
            echo "win"
        case "*"
            echo "unknown"
    end
end

# Utility function to print the command that would be used to set the `$OS_NAME` variable
# EXAMPLE OUTPUT:
# `set --global --export OS_NAME 'mac'` 
function __get_os_name_print_dry_run_colored  \
    --description "Print the command that would be used to set the $OS_NAME variable, with syntax highlighting colors" \
    --no-scope-shadowing

    # the values below are used to build the command that would be executed
    set -l cmd_val 'set'
    set -l flags_val (string join ' ' -n -- $scope_flags)
    set -l var_val 'OS_NAME'
    set -l str_val "'$os_name'"

    # define colors for syntax highlighting
    set -l cmd_color (set -q fish_color_command; and set_color $fish_color_command || set_color blue)
    set -l args_color (set -q fish_color_param; and set_color $fish_color_param || set_color cyan)
    set -l var_color (set_color magenta --bold)
    set -l str_color (set -q fish_color_quote; and set_color $fish_color_quote --italic || set_color yellow --italic)
    set -l normal_color (set_color normal)

    # print the command with colors
    string join ' ' -n -- $cmd_color$cmd_val$normal_color \
        $args_color$flags_val$normal_color \
        $var_color$var_val$normal_color \
        $str_color$str_val$normal_color

    # always return 0, so that the chaining of conditionally executed commands
    # works as expected
    return 0
end
