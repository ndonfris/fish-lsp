echo "hello world" | read -l a
for i in (seq 1 10)
    echo "hello world: $i"
end
function hello --description "prints hello world" -a  b c d --inherit-variable PATH
    echo "hello world: $b $c $d"
    echo "$argv"
    echo "$PATH"
end
set --global e "$a$b"
set --universal f "$b$c"
