#!/usr/bin/env fish

# Prints the function `alias` would define for an `alias` command, without defining it.
#
# `alias` itself `source`s `function $name …⏎    $body $argv⏎end`, so running an `alias`
# line from a file would also run whatever its body holds: `alias x='end; rm …; function y'`.
# These are `alias`'s own steps, printing that text instead.
#
# $argv: each of the `alias` arguments as fish source that can't run anything (see
#        `safeFishSource()`), expanded here into its value.
#
# >_ fish alias-function.fish "ll='ls -la'"
#    function ll --wraps='ls -la' --description 'alias ll=ls -la'
#        ls -la $argv
#    end

set -l args
for arg in $argv
    eval set -a args $arg
end

set -l name
set -l body
if not set -q args[2]
    # Alias definition of the form "name=value".
    set -l tmp (string split -m 1 = -- $args) ''
    set name $tmp[1]
    set body $tmp[2]
else
    # Alias definition of the form "name value".
    set name $args[1]
    set body $args[2]
end
test -n "$name"; and test -n "$body"; or return 1

printf '%s\n' $body | read -l --list words
set -l first_word $words[1]
set -l last_word $words[-1]

# Prevent the alias from immediately running into an infinite recursion if
# $body starts with the same command as $name.
if test "$first_word" = "$name"
    if contains -- $name (builtin --names)
        set body "builtin $body"
    else
        set body "command $body"
    end
end

# Laid out like `functions $name` prints it
set -l header function (string escape -- $name)
if test "$first_word" != "$name"; and test "$last_word" != "$name"
    set -a header --wraps=(string escape -- $body)
end
set -a header --description (string escape -- "alias $args")

printf '%s\n' "$header" "    $body \$argv" end | fish_indent
