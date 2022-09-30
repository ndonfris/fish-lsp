#!/usr/bin/fish 

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
    fish -c 'complete --do-complete=" " | uniq -u'
end

# gets all of the aliases a user has defined
function get_aliases
    for _x in (fish -c 'complete --do-complete=" " | uniq -u');
        string match -e -r "\talias " $_x 2>/dev/null
    end
end


# gets all of the possible commands for a user
function get_commands
    for _x in (fish -c 'complete --do-complete=" " | uniq -u'); 
        if string match -v -q -e -r "\tcommand link" $_x;
            set -l _cmd (string match -e -r '\tcommand' $_x | cut  -f1)
            set -l _cmd2 (echo $_x | tr -s ' ' \n)
            if test -n "$_cmd"
                printf "Command:\t$_cmd\n"
            else if test (count $_cmd2) -eq 1
                printf "Command:\t$_x\n"
            end
        end
    end
end

# gets all of the possible builtins for a user
function get_builtins
    for _x in (builtin -n);
        if test "$_x" = '.' -o "$_x" = ':'
            continue
        end
        set -l _xd (string match -v "$_x - " (man --all $_x | head -n 5 | grep 'NAME' --after-context=1 --text | tr 'NAME' ' ' | string trim -l))
        printf "Builtin: $_x\t$_xd\tman $_x\n"
    end
end


# gets all of the possible abbr
function get_abbrs
    for _x in (complete --do-complete=" " | uniq -u);
        string match -e 'Abbreviation:' $_x
    end
end

# gets all of the possible vars for a user
function get_vars
    for _x in (set -n); 
        set -l var_location (string match -r -g "(universal|global)" (set -S $_x));
        if test -n "$$_x"
            printf "$$_x\t$_x\tVariable: $$_x\t$var_location\n" 2>/dev/null
        end
    end;
end

# print help message
function get_help
    printf "get-global-info.fish\n"
    printf "USAGE:\n\t\t fish get-global-info.fish\n [ARGUMENT(S)]\n\n"
    printf "pass one or more of the following arguments into this file:\n"
    set -a -l cli_args 'buitlins' 'commands' 'aliases' 'functions' 'abbr' 'vars' 'all' 
    for h_flag in $cli_args
        printf "\t$h_flag\n"
    end
end



for i in (seq 1 (count $argv))
    switch "$argv[$i]"
        case builtins
            get_builtins
            break;
        case commands
            get_commands
            break;
        case aliases
            get_aliases
            break;
        case abbrs
            get_abbrs
            break;
        case vars 
            get_vars
            break;
        case all 
            get_all
            break;
        case "-h" "--help"
            get_help
            break;
        case \*
            echo "ERROR: $argv[$i]"
            echo ""
            get_help
            break
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
