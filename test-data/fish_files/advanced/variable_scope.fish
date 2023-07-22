#!/usr/bin/fish

# file to show how scope works in fish shell
# notice that the variable i is still available after the for loop
# and that the variable ii is not available after the if statement

for i in (seq 1 10)
    echo "."
end
echo $i


if true
    set ii 20
else 
    set ii -1
end

echo $ii

function aaa
    set v "hi"
    function bbb
        set v "hello"
    end
    echo $v
    bbb
end

aaa

begin;
    set ii 30
end;

echo $ii