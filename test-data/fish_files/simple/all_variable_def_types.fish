echo "hello world" | read -l a
for i in (seq 1 10)
    echo "hello world: $i"
end
function hello -a  b c d
    echo "hello world: $b $c $d"
    echo "$argv"
end
set --global e "$a$b"
set --universal f "$b$c"
