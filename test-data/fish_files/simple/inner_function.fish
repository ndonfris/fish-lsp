
function outer
    function inner
        set --local a "a"
        set --local a "aa"
        set --local a "aaa"
    end
    set a "A"
end