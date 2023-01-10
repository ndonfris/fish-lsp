function multiple_broken_scopes
    set -l var "$argv"
    if test "$var" = hello
        echo hello
        or echo "bad 1"
        and echo "bad 2"
        or echo "bad 3"; and return 1;
        echo "bad 4"
    else
        echo hi; return 1
        echo 'bad again'
    end
end

