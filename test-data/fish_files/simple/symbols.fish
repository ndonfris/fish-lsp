set -l arg_two 'seen one time' 

function func_a
    set -l arg_one $argv[1]
    for i in (seq 1 10)
        echo "$i: $arg_one"
    end
end

set -l arg_two 'seen two times'

function func_b
    for i in (seq 1 10)
        func_a $argv
    end
end

set -l arg_two 'seen three times'

function func_c --argument-names arg_one
    for i in (seq 1 10)
        func_a $arg_one
         
    end
end

func_b $arg_two