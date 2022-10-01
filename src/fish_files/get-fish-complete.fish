#!/usr/bin/fish 



set -l args_amount (count $argv)

echo $args_amount

echo $argv[$args_amount]

set -l cmps (fish -c "complete --do-complete='$argv'")
set -l cmps_amount (count $cmps)

for cmp in $cmps
    echo $cmp
end













