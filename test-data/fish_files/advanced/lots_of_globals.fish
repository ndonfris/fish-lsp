# lots_of_globals -- creates 4 global variables
function lots_of_globals --description "Lots of globals" 
    set -gx a 1
    set -gx b 2
    set -gx c 3
    set -gx d 4
end


set --global abcd 1 2 3 4
set --local ghik 5 6 7 8
set --universal mnop 9 10 11 12
set zxcv 13 14 15 16

__lots_of_globals_helper

function __lots_of_globals_helper 
    set --global PATH '/usr/local/bin' '/usr/bin' '/bin' '/usr/sbin' '/sbin'
end
