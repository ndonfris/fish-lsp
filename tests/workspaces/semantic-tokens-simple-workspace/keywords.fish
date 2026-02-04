#!/usr/bin/env fish
# Keyword usage

if test -f /tmp/file
    echo "exists"
else
    echo "not found"
end

for item in a b c
    echo $item
end

while true
    break
end

switch $value
    case 1
        echo "one"
    case 2
        echo "two"
    case '*'
        echo "other"
end
