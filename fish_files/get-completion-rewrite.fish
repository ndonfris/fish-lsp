#!/usr/bin/env fish

set cmp_input (string collect $argv)

complete --do-complete --escape $cmp_input
