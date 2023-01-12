function __multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; 
        return 0
    else
        return 0
    end
    echo 'yes'
end

if test -z $argv
    return 0
    echo 'a'
else 
    return 1
    echo 'b'
end
echo "howdy"

