
function cdls -d "Change directory and list contents"
    if test (count $argv) -eq 0
        echo "Usage: cdls <directory>"
        return 1
    end
    
    if cd $argv[1]
        ls
    end
end
