#!/usr/bin/env fish

# takes a single argument and returns a string/token 
# without throwing an error

# possible return values are:
#      'builtin'
#      'variable'
#      'abbr'
#      'command'
#      'function'
#      'alias' ?

# meant to be used on a token. Below outlines the inclusion and exclusion of behavior
# expected by this shell script.
#    includes: some_builtin | some_function | some_variable | some_abbr | some_command
#    excludes: options | flags | subcommands | $variable | $$variables


function get_type_verbose --argument-names str
  # EDITING THIS SCRIPT? 
  # ORDER OF OPERATIONS MATTERS!
  if builtin --query -- "$str"
    echo "builitn"
  else if abbr -q -- "$str"
    echo 'abbr'
  else if functions --all --query -- "$str"
    # could be alias or function
    echo 'function'
  else if command -q -- "$str"
    echo 'command'
  else if set --query -- "$str"
    echo 'variable'
  else
    echo ''
  end
end

function get_first_token
  string match -req '^(\w+)-(\w+)$' -- "$argv"
  and string split -m 1 -f 1 '-' -- "$argv"
  or echo "$argv[1]"
end


set -l first "$(get_first_token $argv)"

get_type_verbose $first