########## PROGRAM
set --global testvar "global symbol"
echo $testvar

function _test 
    set --local testvar "local symbol"
    echo $testvar
    set --global testvar "inner global symbol"
end

_test


set testvar "global symbol"
echo $testvar