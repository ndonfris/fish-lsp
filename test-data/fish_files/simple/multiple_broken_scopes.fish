function multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; 
        return 0;
    else if test "$var" = world
        echo $var
        return 0
    else
        echo a
        return 0
    end
    set -l var "$argv"

    if test -z "$argv"
        if test -z 'a'
            return 0
        else
            return 0
        end
        echo "hi"
        return 0
    else 
        return 0
    end
    echo "hi"
end

