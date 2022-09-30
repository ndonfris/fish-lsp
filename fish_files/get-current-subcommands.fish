#!/usr/bin/fish 


for _sub in (fish -c "complete --do-complete='$argv '")
    if test -f $_sub
        continue;
    else if test -d $_sub
        continue;
    else 
        echo $_sub;
    end

end
