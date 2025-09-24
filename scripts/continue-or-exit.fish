#!/usr/bin/env fish

source ./scripts/pretty-print.fish

### Example:
### ```fish
### >_ continue_or_exit -q || echo $status`
### ```

function continue_or_exit --description 'reusable fish prompt utility for shell script continuation'
    set -l original_argv $argv

    argparse h/help q/quiet Q/quit no-empty-accept no-retry prepend-prompt= time-in-prompt prompt-str= quiet-prompt other-opts=+ no-quit-opts -- $argv 
    or return

    if set -q _flag_help
        echo "Usage: continue_or_exit [-h|--help] [-q|--quiet] [--quit] [--no-empty-accept] [--no-retry] [--other-opts='OPT_1,OPT_2,...'] [--no-quit-opts]"
        echo ''
        echo 'Ask user to continue or exit.'
        echo 'If the user input is not valid, it will ask again (when --no-retry is not given).'
        echo ''
        echo 'Options:'
        echo '  -h, --help                Show this help message and exit.'
        echo '  -q, --quiet               Do not print any output message.'
        echo '  -Q,--quit                 Add separate quit Q/q option to exit w/ status 2'
        echo '                            Normally the Q/q option will be treated the same as n/N'
        echo '  --time-in-prompt          Add time to the prompt string.'
        echo '  --prepend-prompt STRING   Add text to the start of the prompt string.'
        echo '  --prompt-str STRING       Customize the prompt string.'
        echo '  --quiet-prompt            Do not print a prompt string or any output message'
        echo '                            equivalent to `continue_or_exit -q --prompt-str=\'\'`'
        echo '  --no-empty-accept         Do not accept empty input.'
        echo '  --no-retry                Do not ask again if the input is not valid.'
        echo '  --other-opts 1,2,3        Add other acceptable options to the prompt.'
        echo '  --no-quit-opts            Do not add quit options, `Q/q`, to exit prompt list.'
        echo ''
        echo 'Examples:'
        echo "  >_ continue_or_exit -q || echo \$status"
        echo ''
        echo "  >_ set -l idx 1"
        echo "  >_ while continue_or_exit"
        echo "  >_   echo 'idx: \$idx'"
        echo "  >_   set idx (math \$idx+1)"
        echo "  >_ end"
        echo ''
        echo "  >_ set -l output (continue_or_exit --other-opts 'a,b,c' --prepend-prompt '(a,b,c)' --no-quit-opts)"
        echo "  >_ # input your choice, a selection of --other-opt will be stored in output"
        echo "  >_ set --show output"
        echo "  >_ switch \$output"
        echo "  >_     case a"
        echo "  >_         echo 'You selected a'"
        echo "  >_     case b"
        echo "  >_         echo 'You selected b'"
        echo "  >_     case c"
        echo "  >_         echo 'You selected c'"
        echo "  >_     case *"
        echo "  >_         echo 'You selected something else'"
        echo "  >_ end"
        exit 0
    end

    set -l yes_options Y y ''
    set -l no_options N n
    set -l quit_options Q q
    set -l retry_options '*'
    set -l other_options ''

    if set -q _flag_no_quit_opts
        set -a retry_options $quit_opts
        set -e quit_options
    end

    if set -q _flag_no_empty_accept
        set yes_options Y y
        set --append retry_options ''
    end

    # if set -q _flag_quiet_prompt && set a
    if set -q _flag_quiet_prompt
        set _flag_quiet 1
        set _flag_prompt_str ''
    end

    if set -q -l _flag_other_opts
        if test (count $_flag_other_opts) -gt 1
            set other_options $_flag_other_opts
        else if string match -raq ',' -- $_flag_other_opts
            set other_options (string split ',' -n -- $_flag_other_opts)
        else if string match -raq ' ' -- $_flag_other_opts
            set other_options (string split ' ' -n -- $_flag_other_opts)
        end
        if test -n "$other_options" && test (count $other_options) -gt 0
            set yes_options $yes_options $other_options
        end
    end

    not set -q _flag_no_quit_opts && set -q _flag_quit && set --append no_options Q q

    if set -q _flag_prompt_str
        set prompt "$_flag_prompt_str"
    else
        set prompt (print_text_with_color '--bold white' 'Continue?') "$(print_text_with_color 'brcyan --italic' '  [Y/n]  ')"
    end

    if set -q _flag_prepend_prompt
        set prompt (print_text_with_color 'brblue --italic' "$_flag_prepend_prompt") $prompt
    end

    if set -q _flag_time_in_prompt
        set prompt (print_text_with_color '--background normal yellow' "(TIME: $(date +%T))  ") $prompt
    end

    function _abort_read --inherit-variable answer --inherit-variable _flag_quiet
        set -q _flag_quiet && return 0
        print_text_with_color brred Aborted
        return 0
    end

    read --nchars 1 --prompt-str "$prompt" --local answer
    or _abort_read && return 1

    set -gx CONTINUE_OR_EXIT_ANSWER $answer

    switch "$answer"
        case $yes_options
            if contains -- "$answer" $other_options
                not set -q _flag_quit && echo $answer
                return 0
            end
            not set -q _flag_quiet && print_text_with_color green "Continuing...\n"
            return 0
        case $no_options
            not set -q _flag_quiet && print_text_with_color red "Exiting...\n"
            return 1
        case $quit_options
            set -q _flag_quit && set msg_args magenta "Quitting...\n" || set msg_args red "Exiting...\n"
            not set -q _flag_quiet && print_text_with_color $msg_args[1] $msg_args[2]
            set -q _flag_quit && return 2
            or return 1
        case $retry_options
            set -q _flag_no_retry && set msg_args blue "Invalid input: '$answer'\n" || set msg_args red "Invalid input: '$answer'\nPlease try again.\n"
            not set -q _flag_quiet && print_text_with_color $msg_args[1] $msg_args[2]
            set -q _flag_no_retry && return 1
            continue_or_exit $original_argv
    end

end

function print_text_with_color --argument-names color text --description 'Print with color'
    echo $color | read --delimiter=' ' -a fixed_color
    [ (count $fixed_color) -eq 1 ] && set fixed_color --bold $fixed_color
    set_color $fixed_color
    echo -ne "$text"
    set_color normal
end
