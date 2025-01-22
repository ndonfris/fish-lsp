#!/usr/bin/env fish

string collect -- $argv | read --tokenize --local cmd
fish --private --command "$cmd" 2> /dev/null
