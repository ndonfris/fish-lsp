#!/usr/bin/env fish

string collect -- $argv | read --tokenize --local cmd
fish --command "$cmd" 2>/dev/null
# begin
#   string collect -- $argv | read --local --tokenize cmd
#   fish --command "$cmd"
# end 2>/dev/null
