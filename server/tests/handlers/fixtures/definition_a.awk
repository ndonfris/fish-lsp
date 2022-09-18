@include "definition_b.awk"
@include "definition_c.awk"

function f(x) {}

{ f(1); sum(1, 2) }

function a(x) {
    x = 1
}

BEGIN { B::fn() }
