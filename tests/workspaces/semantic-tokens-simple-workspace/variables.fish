#!/usr/bin/env fish
# Variable definitions and expansions

set -l local_var "local"
set -g global_var "global"
set -U universal_var "universal"
set -x exported_var "exported"

echo $local_var
echo $global_var
echo $universal_var
echo $exported_var
echo $PATH $HOME $USER
