#!/usr/bin/env fish

# Example usage:
#
# >_ ./expand_cartisian.fish {a,b,c}/foo/{1,2,3}
#   1  |a/foo/1|
#   2  |a/foo/2|

#   $argv is fish source from `safeFishSource()`: only its braces, plain variables, `~`
#   and escapes are live, so `fish -c` expands it (continuations, quotes and escapes
#   keeping their meaning) without running anything.
function expand_cartesian
    # A variable the expanding fish doesn't have would empty the whole word
    # (`$z/z/{a,b}` → nothing). For each `$name` in the word, guard it in that same
    # fish: keep it if set (so `$HOME` still expands), else make it its own literal
    # `$name` text. The check runs in the child, so a `$idx` in the word is unrelated
    # to the loop counter here.
    set -l guards
    for name in (string match -rag '\$(\w+)' -- $argv)
        set -a guards "set -q $name; or set -l $name '\$$name';"
    end
    set -l idx 1
    for item in (fish -c "$guards printf %s\n $argv")
        printf ' %s  |`%s`|\n' (string pad -c ' ' -w 3 -- "$idx") $item
        set idx (math $idx+1)
    end
end

expand_cartesian $argv
