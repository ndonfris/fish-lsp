# ┌───────┐
# │ utils │
# └───────┘
function __handle_builtin -d 'Retrieve documentation for a fish builtin'
    man $argv 2>/dev/null | command cat
    # Alt Approach:
    #   >_ `__fish_print_help $argv 2>/dev/null | command cat`
end
function __handle_function -d 'Retrieve documentation for a fish function'
    set output (functions -av $argv 2>/dev/null | command cat)
    if test -n "$output"
        printf %s\n $output
        return 0
    else
        echo "ERROR(builtin): $argv doesn't have help documentation" >&2
        return 1
    end
end
function __handle_command -d 'Retrieve documentation for a system command'
    set output (man -a $argv 2>/dev/null | command cat)
    if test -n "$output"
        printf %s\n $output
        return 0
    else
        echo "ERROR(man $argv): $argv doesn't have man page" >&2
        return 1
    end
end

# git worktree --help -> git worktree
# git commit -m "msg" -> git commit
# git --help -> git
function validate_args -d 'Validate input by stopping on first non-option argument'
    for arg in $argv
        switch $arg
            case '-*'
                break
            case '*'
                printf "%s\n" $arg
        end
    end
end

# ┌────────────────────┐
# │ special processing │
# └────────────────────┘
argparse --strict-longopts --move-unknown --unknown-arguments=none --stop-nonopt \
    'function=&' 'builtin=&' 'command=&' 'use-help=&' 'h/help=&' -- $argv
or return 0

# ┌──────────────┐
# │ help message │
# └──────────────┘
if set -ql _flag_h or set -ql _flag_help
    echo "Usage: get-docs.fish [OPTIONS] COMMAND

Retrieve documentation for fish builtins, functions, or commands.

Options:
  --function         Retrieve documentation for a fish function
  --builtin          Retrieve documentation for a fish builtin
  --command          Retrieve documentation for a system command
  --use-help         Use help documentation if available
  -h, --help         Show this help message and exit

Examples:
  >_ get-docs.fish cd
  >_ get-docs.fish complete
  >_ get-docs.fish --function my_custom_function
  >_ get-docs.fish --builtin set
"
    return 0
end

# ┌────────────┐
# │ core logic │
# └────────────┘

if set -ql _flag_use_help
    eval $argv --help
    return $status
end

if set -ql _flag_builtin || builtin -q $argv[1] 2>/dev/null
    __handle_builtin (string join '-' --no-empty -- (validate_args $argv))
    return $status
end

if set -ql _flag_function || functions -aq $argv[1] 2>/dev/null
    __handle_function $argv
    return $status
end

if set -ql _flag_command || command -aq $argv[1] 2>/dev/null
    __handle_command (string join '-' --no-empty -- (validate_args $argv))
    return $status
end

echo "ERROR: '$argv' is not a valid fish builtin, command or function" >&2
return 1

# if set -ql _flag_use_help
#     if set -ql _flag_allow_help
#         echo "ERROR: '--use-help' requires at least one of '--function', '--builtin', or '--command' to be specified" >&2
#         return 1
#     else
#         return 0
#     end
# end
#
# if builtin -q $argv 
#     __fish_print_help $argv 2>/dev/null | command cat
# else if functions -aq $cmd
#     set output (functions -av $cmd 2>/dev/null | command cat)
#     if test -n "$output"
#         echo $output
#     else
#         echo "ERROR(builtin): $argv doesn't have help documentation" >&2
#         return 1
#     end
# else if command -aq $argv
#     set output (man -a $argv 2>/dev/null | command cat)
#     if test -n "$output"
#         echo $output
#     else
#         echo "ERROR(man $argv): $argv doesn't have man page" >&2
#         return 1
#     end
# else
#     echo "ERROR: '$argv' is not a valid fish command or function" >&2
#     return 1
# end
#
