function ls --wraps=exa --wraps='exa -a --group-directories-first --sort oldest -1' --description 'alias ls=exa -a --group-directories-first --sort oldest -1'
    ## check if exa is available and use it, otherwise fall back to ls
    ## if more than 100 entries, do not use the -1 option
    if command -aq exa
        if [ (exa -1 $argv | count) -gt 100 ]
            exa -a --group-directories-first --sort oldest $argv
        else
            exa -a --group-directories-first --sort oldest -1 $argv
        end
    else
        if [ (command ls -1 --color --sort time | count) -gt 100 ]
            command ls -a --group-directories-first --sort time $argv
        else
            command ls -a --group-directories-first --sort time -1 $argv
        end
    end
end
