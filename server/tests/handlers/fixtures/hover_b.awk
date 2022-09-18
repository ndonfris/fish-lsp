# Sums two numbers
function sum(a, b) {
    return a + b
}

BEGIN {
    var_b = 42
}

@namespace "B"

BEGIN { x = "b" }

function fn(b) {}
