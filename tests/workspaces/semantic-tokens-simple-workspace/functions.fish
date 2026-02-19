#!/usr/bin/env fish
# Function definitions and calls

function my_func
    echo "in my_func"
end

function another_func
    echo "in another_func"
    my_func
end

my_func
another_func
