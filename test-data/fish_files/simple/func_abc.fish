function func_a
    set -l a a a
end

function func_b
    #set -l b bb bb
    set -U b bb
end

# func_c -> c
function func_c
    set -l c ccc ccc
end
