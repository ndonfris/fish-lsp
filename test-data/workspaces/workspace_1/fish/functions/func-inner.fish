
function func-inner --argument-names arg1 arg2
    echo "func-inner"

    function __inner
        printf "\t%s" "__inner  "
        printf "%s\n" $argv
    end

    if set -q arg1 && set -q arg2
        __inner "arg1 and arg2 are set"
        __inner "arg1: $arg1"
        __inner "arg2: $arg2"
    else
        __inner "arg1 and arg2 are not set"
    end
end

 #func-inner a b