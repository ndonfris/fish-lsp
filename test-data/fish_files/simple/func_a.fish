function func_a --description "this is func_a"
    set -l a a a
    printf %s\n a a a | string join \n

end
#switch "$argv"; case "*"; end
#switch $argv; case *;end
#(program
# (command name: (word) argument: (double_quote_string) redirect: (file_redirect operator: (direction) destination: (word)))
# (command name: (word))
#)