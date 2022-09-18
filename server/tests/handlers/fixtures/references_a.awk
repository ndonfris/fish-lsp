@include "references_b.awk"

function f(x) { x = "f" }

{ f(1); sum(1, 2); x = "global" }

@namespace "A"

function fn(a) {}

BEGIN {
    print A::fn(1)
    print B::fn(1)
}
