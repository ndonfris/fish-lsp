function multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; 
    else if test "$var" = world
        echo $var
        return 0
    else
        echo hi;
        return 1
    end
    set -l var "$argv"
    for i in (seq 1 10) 
        echo "hi"
    end
end

