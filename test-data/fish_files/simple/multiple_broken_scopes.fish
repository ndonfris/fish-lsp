function multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; 
        return 1
    else
        echo hi;
        return 0
    end
end

