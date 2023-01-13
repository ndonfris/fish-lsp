
# from my fish functions 
function get-completions
    set -l s (string escape -n --style=script "$argv")
    #echo $s
    set cmd complete --do-complete="$s" 
    eval $cmd
end

