@include "rename_b"

function a(var_a) { var_a = 1 }

BEGIN { var_a = a(); var_b = b() }

@namespace "A"

function a(x) {}
