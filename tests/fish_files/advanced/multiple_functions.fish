# preceding chars
function multiple_functions --argument-names file1 file2 file3
    echo "file1 is $file1"
    echo "file2 is $file2"
    echo "file3 is $file3"
end


function other_functions
    for i in $argv
        echo "file$i is $i"
    end
    for i in $argv
        echo "file$i is $i"
    end
end

set --local files 'file1' 'file2' 'file3'
other_functions "$files"



set --universal files 'not'
