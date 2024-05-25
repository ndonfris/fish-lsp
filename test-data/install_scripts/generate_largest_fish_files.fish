#!/usr/bin/fish 

# moves large test files into test_data 

for fl in (du /usr/share/fish/functions/*.fish | sort -n -r | head -n 10 | cut -d \t -f2);
    set -l fl_relative_path (echo "$fl" | string split '/' -r --max 1)[2]
    echo -e "copying \"$fl_relative_path\" to \"test_data/fish_files/$fl_relative_path\""
    cp "$fl" "./fish_files/$fl_realtive_path"
end
