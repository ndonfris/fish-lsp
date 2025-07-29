#!/usr/bin/env fish

# Example usage:
#
# >_ ./expand_cartisian.fish {a,b,c}/foo/{1,2,3}
#   1  |a/foo/1|
#   2  |a/foo/2|

function expand_cartesian
    set idx 1
    for item in (fish -c "printf %s\n $(string split0 -- (string collect -- $argv | string unescape | string join0))")
        printf ' %s  |`%s`|\n' (string pad -c ' ' -w 3 -- "$idx") $item
        set idx (math $idx+1)
    end
end

expand_cartesian $argv
