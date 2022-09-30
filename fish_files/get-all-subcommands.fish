#!/usr/bin/fish


set -l ignore_completions "vared" "funced" "begin" "while" "if" "for" "function" "functions" "funcsave" "help"

for func in (fish -c "complete -C '' | cut -f1 | uniq -i")
    #set -l func (echo (echo $func | cut -f1 | tr -s ' ' '\n' )[1])
    #echo $func
     if contains  $func $ignore_completions
         continue 
     end
     set -l subcommands (complete --do-complete "$func " | tr -s ' ' '\n' )
     set -l stop_sub 0
     for x in $subcommands;
         if test -f $x;
             set stop_sub 1
             break;
         end;
         if test -d $x;
             set stop_sub 1
             break;
         end;
         if test -x $x;
             set stop_sub 1
             break;
         end;
     end
     if test $stop_sub -eq 0; and test (count $subcommands) -gt 1
         echo "---"
         echo "$func"
         echo "$subcommands"
         echo "---"
     end;
end
#for func in ( functions --all ) (builtin -n ) ;
#    if test (count (complete --do-complete "$func " | tr -s ' ' '\n')) -gt 3;
#        echo $func; 
#    end;
#
#end;
