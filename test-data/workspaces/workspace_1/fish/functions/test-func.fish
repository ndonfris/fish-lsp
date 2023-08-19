
function test-func
    set -l count 1
    for arg in $argv
        __helper-test-func $count $arg
        set count (math $count + 1)
    end
end



function __helper-test-func --argument-names index arg
    printf "index:$index argument:$arg\n"
end

# $ fish test-data/fish_files/functions/test-func.fish 1 2 3
# test-func a b c