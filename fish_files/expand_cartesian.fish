#!/usr/bin/env fish

# Example usage:
#
# >_ ./expand_cartisian.fish {a,b,c}/foo/{1,2,3}
#   1  |a/foo/1|
#   2  |a/foo/2|

# set og_argv $argv
#
# argparse --stop-nonopt --ignore-unknown all test -- $argv
# or return

# set unescaped_argv (string unescape -- $argv)
# set collected_argv (string collect -- $argv)
# set no_quotes_argv (string trim --chars '"' -- $argv)
# set striped_argv (echo $argv | string replace -r '(^| )"([^"]+)"' '$1$2' | string split ' ')

function expand_cartesian
    set idx 1
    # set -l total_count (count (fish -c "printf %s\n $(string split0 -- (string collect -- $argv | string unescape | string join0))"))
    # echo "total expanded items count: $total_count"
    # string repeat --count $COLUMNS '─'
    for item in (fish -c "printf %s\n $(string split0 -- (string collect -- $argv | string unescape | string join0))")
        printf ' %s  |`%s`|\n' (string pad -c ' ' -w 3 -- "$idx") $item
        set idx (math $idx+1)
    end
end


# if set -ql _flag_all
#     echo "Expanding default: $og_argv"
#     expand_cartesian $argv
#     string repeat --count 20 '-'
#     echo "Unescaped: '$unescaped_argv'"
#     expand_cartesian $unescaped_argv
#     string repeat --count 20 '-'
#     echo "Collected: '$collected_argv'"
#     expand_cartesian $collected_argv
#     string repeat --count 20 '-'
#     echo "No quotes: '$no_quotes_argv'"
#     expand_cartesian $no_quotes_argv
#     string repeat --count 20 '-'
#     echo "Striped: '$striped_argv'"
#     expand_cartesian $striped_argv
# else if set -ql _flag_test
#     expand_cartesian_2 $argv
# else
expand_cartesian $argv
# end

