# function to source the fish shell config
function source_fish -d "source fish config w/ parsing"
    argparse f/force h/help q/quiet no-parse -- $argv
    or return 

    if set -q _flag_help
        echo "source_fish [-f | --force] [-h | --help] [-q | --quiet] [--no-parse] [-e | --edit]"
        echo "USAGE:"
        echo -e '  -h, --help\tshow help'
        echo -e '  -f, --force\tforce sourcing'
        echo -e '  -q, --quiet\tsilence'
        echo -e '  --no-parse\tskip parsing check'
        echo -e '  -e, --edit\tedit source_fish files'
        return
    end

    if set -q _flag_edit
        $EDITOR ~/.config/fish/{completions,functions}/source_fish.fish
        fish --no-execute ~/.config/fish/functions/source_fish.fish
        source ~/.config/fish/functions/source_fish.fish
        return $status
    end

    if set -q _flag_no_parse
        set _flag_quiet 1
    end


    if set -q _flag_force
        fish --no-execute ~/.config/fish/config.fish
        clear
        exec fish
        return
    end

    if set -q _flag_quiet
        source ~/.config/fish/config.fish
        exec fish
        return
    end


    if set -q _flag_sleep
        __echo_and_run 'fish --no-execute ~/.config/fish/config.fish'
        __echo_and_run 'source ~/.config/fish/config.fish'
        __echo_and_run 'exec fish'
        return $status
    end

    fish --no-execute ~/.config/fish/config.fish
    clear
    exec fish
end

function __echo_and_run
    set_color blue && echo $argv && set_color normal;
    eval $argv;
    set -l exit_code $status
    commandline -f repaint
    __sleep_timer
    if test $exit_code -ne 0
        set_color --bold red &&  echo -n 'status: ' && set_color normal && echo $exit_code;
    else
        set_color --bold green && echo -n 'status: ' && set_color normal && echo $exit_code;
    end
    print_separator
    return $exit_code
end

function __sleep_timer
    for i in (seq 1 3)
        sleep 0.2 && echo -n ".";
    end
    echo '';
end
