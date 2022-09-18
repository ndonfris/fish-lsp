function f() {
    print $1
}

{
    f()
    $1 = "hi"
}
