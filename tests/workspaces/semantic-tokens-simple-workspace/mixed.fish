#!/usr/bin/env fish
# Mixed features

function process --argument-names input_file output_file
    set -l temp_var (cat $input_file)

    if test -n "$temp_var"
        echo $temp_var > $output_file
    end
end

set -g DATA_DIR /var/data
process -- $DATA_DIR/input.txt $DATA_DIR/output.txt
