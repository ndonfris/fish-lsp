#!/usr/bin/env fish

function get-used-tests
    set all_used_files (jq -r '.scripts["test-hook"]' ./package.json | string split jest -m1 -f2 | string split ' ' -n; echo 'helpers.ts')
    for file in $all_used_files
        if string match -req '^test-data\/.*' "$file"
            echo $file
        else
            echo test-data/$file
        end
    end
end

set all_tests (command ls -1 test-data/*.ts)
set used_tests (get-used-tests)

set -gx to_remove_tests
set -gx to_keep_tests

for test in $all_tests
    if contains $test $used_tests
        set -agx to_keep_tests $test
    else
        set -agx to_remove_tests $test
    end
end

set_color blue --bold --underline && echo 'FILES TO KEEP' && set_color normal
for test in $to_keep_tests
    set_color blue --bold && echo -n 'command ls' && set_color normal && set_color white && echo ' '$test
end
echo ''

set_color magenta --bold --underline && echo 'FILES TO REMOVE' && set_color normal
for test in $to_remove_tests
    set_color magenta --bold && echo -n 'rm -if' && set_color normal && set_color red && echo ' '$test
end
echo ''

for test in $to_keep_tests
    if not test -f $test
        set_color black --background red --bold --underline && printf " ERROR! To keep file does not exist " && set_color normal
        set_color red && echo -n " $test " && set_color normal
        set_color normal && echo ''
    end
end

for test in $to_remove_tests
    if not test -f $test
        set_color black --background red --bold --underline && printf " ERROR! To remove file does not exist " && set_color normal
        set_color red && echo -n " $test " && set_color normal
        set_color normal && echo ''
    end
end

set -l total_files (command ls -1 ./test-data/*.ts | count)
set_color '#5f5fd7' --bold && printf '-----------------------------------------------------------\n' && set_color normal
if test (math (count $to_keep_tests)+(count $to_remove_tests)) -eq $total_files
    set_color green && echo -n " SUCCESS! "
    set_color normal --background normal
    set_color white && printf %s\n ' TOTAL FILES == $to_keep_tests + $to_remove_tests '
else
    set_color red && echo -n " FAILURE! "
    set_color normal --background normal
    set_color white && printf %s\n ' TOTAL FILES != $to_keep_tests + $to_remove_tests '
end

set_color green --bold --underline --italic && echo 'TOTAL:' && set_color normal
set_color blue --bold && echo -e "KEEP $(count $to_keep_tests)"
set_color magenta --bold && echo -e "REMOVE $(count $to_remove_tests)"
set_color yellow --bold && echo -ne "test-data/*.ts files:" && set_color white --bold && echo -e " $(command ls -1 test-data/*.ts | count)"

echo ''
set_color '#5f5fd7' --bold && printf '-----------------------------------------------------------\n' && set_color normal
set_color '#5f5fd7' --bold --underline --italic && echo 'COPY AND USE THE FOLLOWING VARIABLES IN A SHELL ENVIORNMENT' && set_color normal
set_color white && echo -n 'set -l ' && set_color normal && set_color magenta && echo -n deprecated_files && set_color red && echo " $to_remove_tests"

set_color normal
echo ''
set_color white && echo -n 'set -l ' && set_color normal && set_color blue && echo -n approved_files && set_color '#82b1ff' && echo " $to_keep_tests"

echo -e "set -gx approved_files $to_keep_tests\n\nset -gx deprecated_files $to_remove_tests" | fish_clipboard_copy