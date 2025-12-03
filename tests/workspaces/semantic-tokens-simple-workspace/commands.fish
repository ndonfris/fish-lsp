#!/usr/bin/env fish
# Builtin commands and user functions

echo "builtin"
set foo bar
read -l input
test -f file.txt

function custom_cmd
    echo "custom"
end

custom_cmd
