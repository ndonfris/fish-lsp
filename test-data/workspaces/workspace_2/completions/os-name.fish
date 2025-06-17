# Completions for `os-name` command
#
# File located at:
#   • ~/.config/fish/functions/os-name.fish

# ┌──────────────────┐
# │ HELPER FUNCTIONS │
# └──────────────────┘

# check if any of the `os-name --is-*` options are used
function __os-name-using-status-check
    __fish_contains_opt is-mac
    or __fish_contains_opt is-linux
    or __fish_contains_opt is-unix
    or __fish_contains_opt is-windows
    or __fish_contains_opt is-win
end

# check if any of the `os-name -g/-l/-U` options are used
function __os-name-using-scope-flag
    __fish_contains_opt -s g global
    or __fish_contains_opt -s U universal
    or __fish_contains_opt -s l local
end

# Check if we should show the --set or --dry-run options
function __os-name-using-dry-run-flag
    not __os-name-using-status-check
    and not __fish_contains_opt set; and not __fish_contains_opt dry-run
    and not __fish_contains_opt -s h help
end

###
### BEGIN COMPLETIONS
### 

complete -c os-name -f # remove the file completion for os-name command
# show help message
complete -c os-name -n 'not __fish_contains_opt -s h help' -s h -l help -d "Show help message"
# --is-* completions
complete -c os-name -n '__os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt set; and not __fish_contains_opt dry-run; and not __fish_contains_opt -s h help' -l is-mac -d "Return 0 if macOS, 1 otherwise"
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt set; and not __fish_contains_opt dry-run; and not __fish_contains_opt -s h help' -l is-linux -d "Return 0 if Linux, 1 otherwise"  
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt set; and not __fish_contains_opt dry-run; and not __fish_contains_opt -s h help' -l is-unix -d "Return 0 if Unix-like (Linux/macOS), 1 otherwise"
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt set; and not __fish_contains_opt dry-run; and not __fish_contains_opt -s h help' -l is-windows -d "Return 0 if Windows, 1 otherwise"
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt set; and not __fish_contains_opt dry-run; and not __fish_contains_opt -s h help' -l is-win -d "Return 0 if Windows, 1 otherwise" 
# set -l/-U/-g completions
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt -s h help' -s g -l global -d "Set variable \$OS_NAME globally"
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt -s h help' -s U -l universal -d "Set variable \$OS_NAME universally"
complete -c os-name -n 'not __os-name-using-status-check; and not __os-name-using-scope-flag; and not __fish_contains_opt -s h help' -s l -l local -d "Set \$OS_NAME variable locally"
complete -c os-name -n 'not __fish_contains_opt -s x export; and not __os-name-using-status-check; and not __fish_contains_opt -s h help' -s x -l export -d "Export variable \$OS_NAME to child processes"
# --set/--dry-run completions
complete -c os-name -n '__os-name-using-dry-run-flag' -l dry-run -d "Show the command that would be used to create \OS_NAME"
complete -c os-name -n '__os-name-using-dry-run-flag' -l set -d "Set the variable \$OS_NAME with the detected OS name"
