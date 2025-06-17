
function fzf-history-search --description 'Search your command history with fzf'

    argparse -x c,no-copy,copy-only -x i,r h/help c/copy no-copy copy-only i/insert r/replace -- $argv
    or return

    if set -q _flag_help
        echo "fzf-history-search: Search your command history with fzf"
        echo ""
        echo "Usage:"
        echo "  fzf-history-search [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  -h, --help     Show this help message and exit"
        echo "  --no-copy      Copy selected commands to clipboard"
        echo "  --copy-only    Only copy the selected commands to clipboard (no output)"
        echo "  -c, --copy     Copy selected commands to clipboard"
        echo "  -i, --insert   Insert selected commands into command line"
        echo "  -r, --replace  Replace command line with selected commands"
        echo ""
        echo "Examples:"
        echo "  >_ fzf-history-search --no-copy --insert"
        echo "  The selected commands will be inserted into the command line,"
        echo "  but not copied to the clipboard."
        echo ""
        echo "  >_ bind \cr 'fzf-history-search --insert'"
        echo "  The keybinding Control+R will run `fzf-history-search`, and insert"
        echo "  the selected commands into the command line. Selected commands will"
        echo "  also be copied to the clipboard"
        return 1
    end

    set header_str '    ╭─ Keybindings ─────────────────────────────────────╮
    │ ctrl-y: copy cmd          ctrl-o: reset search    │
    │ ctrl-r: reverse           ctrl-/: change preview  │
    │ ctrl-l: replace query     ctrl-a: toggle all      │
    │ tab: select               ctrl-space: toggle help │
    │ ctrl-z: hide header                               │
    ╰───────────────────────────────────────────────────╯'

    set preview_separator 'set_color green --bold && string repeat -c $COLUMNS -- '─' && set_color normal'
    # preview command
    set preview_header 'begin; set_color --bold white; history search -e (string collect -- {}) --show-time="%m-%d-%y   -   %H:%M:%S | " | string split \' | \' --max 1 -f1; set_color normal;end | head -n 1'
    set preview "$preview_header && $preview_separator && echo -- {} | fish_indent --ansi 2>/dev/null"

    # get the output from the fzf command
    # we reverse because the most recent commands are at the bottom of the input 
    set output (builtin history search -z --reverse | fzf --read0 \
        --no-sort \
        --tac \
        --height 40% \
        --multi \
        --no-info \
        --input-border='none' \
        --no-separator \
        --pointer='>' \
        --marker='•' \
        --border="none" \
        --prompt 'History ><(((°> ' \
        --header '   [ PRESS CTRL-SPACE TO SHOW KEYBINDINGS ]' \
        --header-first \
        --preview-window 'top:4:wrap' \
        --preview "$preview" \
        --bind="ctrl-/:change-preview-window(top,20|top,4)+toggle-header" \
        --bind='ctrl-y:execute-silent(echo {} | fish_clipboard_copy)' \
        --bind='ctrl-r:reload(builtin history search -z)+transform-prompt(echo "Reversed History ><(((°> ")' \
        --bind='ctrl-o:reload(builtin history search -z --reverse)+transform-prompt(echo "History ><(((°> ")' \
        --bind='ctrl-a:toggle-all' \
        --bind='tab:select+down' \
        --bind='ctrl-l:replace-query' \
        --bind='ctrl-z:hide-header' \
        --bind="ctrl-space:change-header($header_str)+toggle-header" \
        | string split0 --no-empty) 


    # make sure to not copy if --no-copy is set
    if set -q _flag_no_copy
        set -e _flag_copy
        set -e _flag_copy_only
    end

    if test -n "$output"
        # copy to clipboard handler
        if set -q _flag_copy || set -q _flag_copy_only 
            for item in $output
                fish_clipboard_copy $item
            end
            # copy only would make it so that commandline is not touched
            if set -q _flag_copy_only
                commandline --function repaint
                return 0
            end
        end

        set -l new_output (string join '\n' -- $output)

        # insert into commandline
        if set -q _flag_insert 
            commandline --insert -- $new_output
            commandline --function repaint
            return 0
        end

        # replace commandline
        if set -q _flag_replace
            commandline -r -- $new_output
            commandline --function repaint
            return 0
        end

        # defaults to insert operation
        set -l new_output (string join '\n' -- $output)
        commandline --insert -- $output
        commandline --function repaint
        return 0
    end

    # nothing selected repaint commandline
    commandline --function repaint
end

