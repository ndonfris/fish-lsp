#!/usr/bin/env fish

### File was take from the following fish shell excerpt:
###  Variable Scope
##       There are four kinds of variables in fish: universal, global, function and local variables.
##
##       • Universal variables are shared between all fish sessions a user is running on one computer. They are stored on disk and persist even after reboot.
##
##       • Global variables are specific to the current fish session. They can be erased by explicitly requesting set -e.
##
##       • Function variables are specific to the currently executing function. They are erased ("go out of scope") when the current function ends. Outside of a function, they don't go out of scope.
##
##       • Local variables are specific to the current block of commands, and automatically erased when a specific block goes out of scope. A block of commands is a series of commands that begins with one  of
##         the commands for, while , if, function, begin or switch, and ends with the command end. Outside of a block, this is the same as the function scope.
##
##       Variables can be explicitly set to be universal with the -U or --universal switch, global with -g or --global, function-scoped with -f or --function and local to the current block with -l or --local.
##       The scoping rules when creating or updating a variable are:
##
##       • When a scope is explicitly given, it will be used. If a variable of the same name exists in a different scope, that variable will not be changed.
##
##       • When no scope is given, but a variable of that name exists, the variable of the smallest scope will be modified. The scope will not be changed.
##
##       • When no scope is given and no variable of that name exists, the variable is created in function scope if inside a function, or global scope if no function is executing.
##
##       There can be many variables with the same name, but different scopes. When you use a variable, the smallest scoped variable of that name will be used. If a local variable exists, it will be used  in‐
##       stead of the global or universal variable of the same name.
##
##       Example:

function test-scopes
    begin
        # This is a nice local scope where all variables will die
        set -l pirate 'There be treasure in them thar hills'
        set -f captain Space, the final frontier
        # If no variable of that name was defined, it is function-local.
        set gnu "In the beginning there was nothing, which exploded"
    end

    echo $pirate
    # This will not output anything, since the pirate was local
    echo $captain
    # This will output the good Captain's speech since $captain had function-scope.
    echo $gnu
    # Will output Sir Terry's wisdom.
end
test-scopes


# When a function calls another, local variables aren't visible:
function shiver
    set phrase 'Shiver me timbers'
end

function avast
    set --local phrase 'Avast, mateys'
    # Calling the shiver function here can not
    # change any variables in the local scope
    # so phrase remains as we set it here.
    shiver
    echo $phrase
end

avast
# Outputs "Avast, mateys"