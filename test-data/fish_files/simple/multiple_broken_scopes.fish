function multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; 
    else
        echo hi;
        return 0
    end
    set -l var "$argv"
    for i in (seq 1 10) 
        echo "hi"
    end
end

