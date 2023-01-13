```man
IF(1)                                             fish-shell                                             IF(1)

NAME
       if - conditionally execute a command

SYNOPSIS
       if CONDITION; COMMANDS_TRUE ...;
       [else if CONDITION2; COMMANDS_TRUE2 ...;]
       [else; COMMANDS_FALSE ...;]
       end

DESCRIPTION
       if  will execute the command CONDITION. If the condition's exit status is 0, the commands COMMANDS_TRUE
       will execute.  If the exit status is not 0 and else is given, COMMANDS_FALSE will be executed.

       You can use and or or in the condition. See the second example below.

       The exit status of the last foreground command to exit can always be accessed using the  $status  vari‐
       able.

       The -h or --help option displays help about using this command.

EXAMPLE
       The  following  code will print foo.txt exists if the file foo.txt exists and is a regular file, other‐
       wise it will print bar.txt exists if the file bar.txt exists and is a regular file, otherwise  it  will
       print foo.txt and bar.txt do not exist.

          if test -f foo.txt
              echo foo.txt exists
          else if test -f bar.txt
              echo bar.txt exists
          else
              echo foo.txt and bar.txt do not exist
          end

       The  following  code will print "foo.txt exists and is readable" if foo.txt is a regular file and read‐
       able

          if test -f foo.txt
             and test -r foo.txt
             echo "foo.txt exists and is readable"
          end

COPYRIGHT
       2022, fish-shell developers

3.5                                              Jul 20, 2022                                            IF(1)
```
[if](https://fishshell.com/docs/current/cmds/if.html)
