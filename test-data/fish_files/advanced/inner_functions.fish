# PROGRAM

function func_a --argument-names arg_1 arg_2
    set --local args "$argv"

    function func_b
        set --local args "$argv 1"
        set --local args "$args 2"
        set --local args "$args 3"
    end

    function func_c
        set --local args "$argv" 
    end

    func_b $args

    func_b $arg_1
    func_c $arg_2


    set --local args "$argv[2]"
    set arg $argv[1]
    for arg in $argv[-2..-1]
        echo $arg
    end

    for arg in $argv[-3..-1]
        echo $arg
    end

    set args "$argv[2]"
end

function func_outside --argument-names arg_1 arg_2
    echo $argv
end

func_a 1 2
func_outside 1 2
set args 'a b c'