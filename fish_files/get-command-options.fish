#!/bin/fish 

set -l result 

# file is just used to get command options
# not used for tokens other than one needing a commandline completion

switch "$argv"
case "test"
    set result (complete --do-complete "$argv -") 
    set -a result (complete --do-complete "$argv ")
case \*
    set result (complete --do-complete "$argv -" | less --chop-long-lines +F | col -bx)
end

for res in $result
    echo "$res"
end
