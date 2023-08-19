# counts down in reverse
for i in (seq 1 10)[-1..1]
    echo $i
end
echo $i; #i should equal 1 -> @see `man for`