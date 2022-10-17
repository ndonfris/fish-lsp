#!/usr/bin/fish 

# locally scope _x
set -l _x


### 
# Decide on a global format for importing into typescript
#
# something like: 
#
#         TYPE: name \t documentation \t ???
### 

# gets all of the possible completions for a user
function get_all_completions
    get_builtins | uniq -i
    get_commands | uniq -i
    get_aliases | uniq -i
    get_abbrs | uniq -i
    get_vars | uniq -i
end

# gets all of the aliases a user has defined
function get_aliases
    for _x in (fish -c 'complete --do-complete=" " | uniq -i');
        string match -e -r "\talias " $_x 2>/dev/null
    end
end


# gets all of the possible commands for a user
function get_commands
    for _x in (fish -c 'complete --do-complete=" " | uniq -i'); 
        if string match -v -q -e -r "\tcommand link" $_x;
            set -l _cmd (string match -e -r '\tcommand' $_x | cut  -f1)
            set -l _cmd2 (echo $_x | tr -s ' ' \n)
            if test -n "$_cmd"
                printf "$_cmd\tcommand\n"
            else if test (count $_cmd2) -eq 1
                printf "$_x\tcommand\n"
            end
        end
    end
end

# gets all of the possible builtins for a user
function get_builtins
    for _x in (builtin -n | uniq -i);
        if test "$_x" = '.' -o "$_x" = ':'
            continue
        end
        set -l _xd (string match -v "$_x - " (man --all $_x | head -n 5 | grep 'NAME' --after-context=1 --text | tr 'NAME' ' ' | string trim -l))
        printf "$_x\tbuiltin\t$_xd\tman $_x\n"
    end
end


# gets all of the possible abbr
function get_abbrs
    for _x in (complete --do-complete=" " | uniq -i);
        set -l abb (string match -g -r '(.*)\tAbbreviation:' $_x ) (string match -g -r '(\tAbbreviation: .*)' $_x )
        if test -n "$abb"
            string replace -r "Abbreviation: " "\tabbr\t" -- (echo $abb)
            #echo $abb
        end
    end
end

# gets all of the possible vars for a user
function get_vars
    # printf "\$%s\t%s\n" weather_windy "$weather_windy"
    # for v in (set -n); begin;  set -l vv (printf %s $$v | head -c 45); printf "%s\t%s\n" $v $vv;end;end; echo $CMD_DURATION
    for _x in (set -n); 
        set -l var_location (string match -r -g "(universal|global)" (set -S $_x) | head -c 45);
        if test -n "$$_x"
            set -l var_value (echo "$$_x" | head -c 45)
            printf "$_x\t$var_location variable\t$var_value\n" 2>/dev/null
        end
    end;
end

# print try implementing later
function get_history
end

# print help message
function get_help
    printf "get-global-info.fish\n"
    printf "USAGE:\n\t\t fish get-global-info.fish\n [ARGUMENT(S)]\n\n"
    printf "pass one or more of the following arguments into this file:\n"
    set -a -l cli_args 'buitlins' 'commands' 'aliases' 'abbr' 'vars' 'all'
    for h_flag in $cli_args
        printf "\t$h_flag\n"
    end
end



for i in (seq 1 (count $argv))
    switch "$argv[$i]"
        case builtins
            get_builtins | uniq -i
        case commands
            get_commands | uniq -i
        case aliases
            get_aliases | uniq -i
        case abbrs
            get_abbrs | uniq -i
        case vars 
            get_vars
        case all 
            get_all_completions
        case debug
            printf '\n\nbuiltins\n'
            get_builtins | head -n10
            printf '\n\ncommands\n'
            get_commands | head -n10 
            printf '\n\naliases\n'
            get_aliases | head -n10 
            printf '\n\nabbrs\n'
            get_abbrs | head -n10 
            printf '\n\nvars\n'
            get_vars | head -n10 
        case "-h" "--help"
            get_help
        case \*
            echo "ERROR: $argv[$i]"
            echo ""
            get_help
            echo "argument 'debug' will show examples for each query"
    end
end



#for func in (functions --names --all | string split ', ');
#    set -l func_loc (functions -D $func)
#    set -l func_type (type -t -a $func)
#    printf "$func\t$func_loc\n"
#end;
#
#for ab in (complete --do-complete=" " | uniq -u);
#    string match -e 'Abbreviation:' $ab;
#end
