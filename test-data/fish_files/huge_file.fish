# sets prompt color to a random color
# stores the color in __random_color variable



#future goals
# • allow for more normal syntax when cmd is specified [ LOCATED IN  ---> __set_cmd_for_color ]
# • implement rainbow feature
# • add more color support
# • add flag --echo-n 
# • add flag to specify a default color [when other color is chosen]
# • extend help messages

set random_color_array_normal (echo red green yellow blue magenta cyan white)
set random_color_array_bright (echo brred brgreen bryellow brblue brmagenta brcyan brwhite) 
set random_color_array_light (echo white "87afff" "d787ff" "5fff87" "87d7ff" "d7d7ff" )
set random_color_array_dark (echo  "00005f"  "5f00d7"  "5f00ff"  "ff0087" "ff00ff" "000000") 
set random_color_array_error (echo red "af0000" "af00ff" "875fff" "ff00ff" "ff87ff")
set colors_16_array (echo black red green purple blue magenta cyan white brblack brred brgreen brpurple brblue brmagenta brcyan brwhite)

function set_random_color -d "sets the terminal color to a random color"
    # declare variables
    set -l special_flag ""
    set -l reset_flag_is_set 0
    set -l cmd_after_color_change ""
    set -l flag_is_set 0
    set -l cmd_is_set 0
    set -l flag_amount 0
    set -l debug_flag_is_set 0
    set -l change_color_cmd
    set -l rainbow_found (__has_rainbow_flag $argv)

    # check if help flag is seen
    set -l help_found (has_help_arg $argv)
    if test "$help_found" = "1";
        __help_message
    end

    #set -l show_colors_found (__has_show_colors_flag $argv)
    #if test "$show_colors_found[1]" = "1"
    #    __print_colors $show_colors_found[2];
    #    return 0;
    #end

    # set variables
    if test (count $argv) -ge 1 
        set special_flag (__set_special_flags $argv)
        set flag_amount (__check_for_leading_flags $argv)
        if test $flag_amount -eq 0
             set flag_amount (count $argv);
        end
        set reset_flag_is_set (__has_reset_flag $argv)
        set cmd_is_set (__has_command_in_stdin $argv)
        set cmd_after_color_change (__set_cmd_for_color $argv)
        set debug_flag_is_set (__has_debug_flag $argv)
    end
    
    # set random color
    # __check_color_prefs_flag -> checks if any color preferences are passed in as flag
    #                             and returns the color preferences array
    set -l colors (string split " " (__check_color_prefs_flag $argv));
    set -l idx (random 1 7)
    if not set -q $__random_color
        set -l old_color (echo "$__random_color")
        set -l new_color (echo "$colors[$idx]")
        while true;
            set new_color (string replace "br" "" $new_color)
            set old_color (string replace "br" "" $old_color) 
            if string match -raq "$new_color" "$old_color"
                set idx (random 1 7)
                set new_color (echo "$colors[$idx]")
                continue;
            else
                break;
            end
        end
    end

    set current_color $colors[$idx]
    set_color $colors[$idx];
    set -g __random_color (echo "$colors[$idx]")


    # fix special_flag formatting
    set special_flag (__fix_special_flag_formatting $special_flag)

    # fix current_color formatting
    set current_color (string trim -- $current_color)

    if test $flag_amount -ge 1;and test "$special_flag" != "";
        set -l color_cmd_string (echo "set_color $__random_color $special_flag");
        set change_color_cmd (string replace -ra "  " " " $color_cmd_string);
    else 
        set -l color_cmd_string (echo "set_color $__random_color");
        set change_color_cmd (string replace -ra "  " " " $color_cmd_string);
    end

    if test $flag_amount -ge 1;or test $cmd_is_set -eq 1
        if test $reset_flag_is_set -eq 1;and test $flag_amount -eq 1
            set_color_normal;
        else if test $reset_flag_is_set -eq 1;and test $cmd_is_set -eq 1
            eval $change_color_cmd;
            eval $cmd_after_color_change;
            set_color_normal;
        else if test $reset_flag_is_set -eq 0;and test $cmd_is_set -eq 1
            eval $change_color_cmd;
            eval $cmd_after_color_change;
        else if test $reset_flag_is_set -eq 0;and test $flag_amount -gt 1
            eval $change_color_cmd;
        else 
            eval $change_color_cmd;
        end
    else 
        eval $change_color_cmd;
    end

    if test $debug_flag_is_set -eq 1
        echo "current_color: "$current_color
    else if test $debug_flag_is_set -eq 2
        __debug_dump_all;
    end
end

function __typeof_random_color_flag
    set -l random_color_flag (string replace -ra "-" "" -- $argv)
    if test $random_color_flag = "0"; or test $random_color_flag = "background"; or test $random_color_flag = "back"; or test $random_color_flag = "B"
        echo 0;
    else if test $random_color_flag = "1"; or test $random_color_flag = "bold"; or test $random_color_flag = "b"
        echo 1;
    else if test $random_color_flag = "2"; or test $random_color_flag = "italic"; or test $random_color_flag = "italics"; or test $random_color_flag = "i"
        echo 2;
    else if test $random_color_flag = "3"; or test $random_color_flag = "underline"; or test $random_color_flag = "u";
        echo 3;
    else if test $random_color_flag = "4"; or test $random_color_flag = "reset";or test $random_color_flag = "normal";or test $random_color_flag = "n";or test $random_color_flag = "r"
        echo 4;
    else if test $random_color_flag = "5";or string match -raq "echo=" "$random_color_flag";or test $random_color_flag = "e"
        echo 5;
    else if test $random_color_flag = "6"; or string match -raq "command=" "$random_color_flag"; or test $random_color_flag = "c"
        echo 6;
    else if test "$argv" = "--";
        echo 7;
    else if test $random_color_flag = "7"; or test $random_color_flag = "debug"; or test $random_color_flag = "dump"; or test $random_color_flag = "d";
        echo 8;
    else if test $random_color_flag = "8"; or test $random_color_flag = "debug-all"; or test $random_color_flag = "dump-all"; or test $random_color_flag = "D"; 
        echo 9;
    else if test $random_color_flag = "bright";
        echo 10;
    else if test $random_color_flag = "light";
        echo 11;
    else if test $random_color_flag = "dark";
        echo 12;
    else if test $random_color_flag = "error";
        echo 13;
    else if test $random_color_flag = "rainbow";
        echo 14;
    else
        echo -1;
    end;
end


function __remove_rainbow_flag
    set -l ret_arr
    for i in (seq 1 (count $argv))
        set -l curr_flag (echo $argv[$i])
        set -l curr_flag_type (__typeof_random_color_flag $curr_flag)
        if test $curr_flag_type -ne 14;
            set -a ret_arr $curr_flag
        end
    end
    echo $ret_arr;
end

function __has_rainbow_flag
    set -l has_flag 0

    for i in (seq 1 (count $argv))
        set -l curr_flag (echo $argv[$i])
        set -l curr_flag_type (__typeof_random_color_flag $curr_flag)
        if test $curr_flag_type -eq 14;
            set has_flag 1;
        end
    end
    echo $has_flag;
end
        

function __get_flag_for_random_color
    set -l argv (string replace -ra "-" "" -- $argv)
    set -l is_color_flag (__typeof_random_color_flag $argv)
    if test $is_color_flag -eq 0;
        echo "--reverse";
    else if test $is_color_flag -eq 1;
        echo "--bold"
    else if test $is_color_flag -eq 2;
        echo "--italics"
    else if test $is_color_flag -eq 3;
        echo "--underline"
    else 
        echo ""
    end
end

function __has_reset_flag
    for i in (seq 1 (count $argv))
        set -l curr_flag (__typeof_random_color_flag $argv[$i])
        if test $curr_flag -eq 4;
            echo 1;
            return;
        end
    end
    echo 0; and return;
end

function __has_command_in_stdin
    #echo $argv
    for i in (seq 1 (count $argv))
        #set -l curr_flag_type (string replace -ra "command=" "" -- $argv[$i])
        set -l curr_flag_type (__typeof_random_color_flag $argv[$i])
        if test $curr_flag_type -eq 5;or test $curr_flag_type -eq 6;or test $curr_flag_type -eq 7;
            echo 1;return;
        end
    end
    echo 0;return;
end

function __set_special_flags
    set -l flag_amount (__check_for_leading_flags $argv)
    set -l special_flag_arr 
    for i in (seq 1 $flag_amount)
        set -l curr_flag $argv[$i]
        set -l curr_flag_type (__typeof_random_color_flag $curr_flag)
        if test $curr_flag_type -eq 0
            set -a special_flag_arr (echo "--reverse")
        else if test $curr_flag_type -eq 1
            set -a special_flag_arr (echo "--bold")
        else if test $curr_flag_type -eq 2 
            set -a special_flag_arr (echo "--italics")
        else if test $curr_flag_type -eq 3
            set -a special_flag_arr (echo "--underline")
        end
    end
    echo $special_flag_arr; return;
end

# here is where we define convert the possible flags:
#            --command="..."
#                 or
#             --echo="..."
function __set_cmd_for_color
    set -l upper_limit (count $argv)
    for i in (seq 1 $upper_limit)
        set -l curr_flag $argv[$i]
        set -l curr_flag_type (__typeof_random_color_flag $curr_flag)
        if test $curr_flag_type -eq 7;
            set -l cmd_idx (math $i)
            echo $argv[$cmd_idx..-1]; return;
        else if test $curr_flag_type -eq 5 -o $curr_flag_type -eq 6
            set curr_flag (string replace -ra '"' "" -- $curr_flag)
            set curr_flag (string replace -ra "'" "" -- $curr_flag)
            set curr_flag (string replace -ra ".*=" "" -- $curr_flag)
            set curr_flag (string trim --left $curr_flag)
            if test $curr_flag_type -eq 5 ;
                echo 'echo -e "$curr_flag"';
            else 
                echo "$curr_flag";
            end
        end
    end
end

function __has_debug_flag
    for i in (seq 1 (count $argv))
        set -l curr_flag (__typeof_random_color_flag $argv[$i])
        if test $curr_flag -eq 8;
            echo 1;
            return;
        else if test $curr_flag -eq 9;
            echo 2;
            return;
        end
    end
    echo 0;
end

function __fix_special_flag_formatting
    set -l special_flag_1 (string replace -r "(\s*)\.*" "" -- $argv)
    set -l special_flag_2 (string trim -- $special_flag_1)
    echo $special_flag_2;
end

function __help_message
    echo ""
    set_random_color --bright --bold --background --underline --italic --reset --command="echo ' set_random_color '";
    spaced_print_seperator;
    set_random_color --bright;
    set_random_color --italic --command='echo -e "\tfunction to set the terminal color to a random color"';
    spaced_print_seperator;
    set_random_color --bold --background -r --command='echo " USAGE: "';
    set_random_color --light  -r --command='echo -ne "set_random_color\ "';
    set_random_color --bright -r --command='echo "[bold] [italic] [underline] [reset]"';
    set_random_color --light  -r --command='echo -e "\t\t [--bold] [--italics] [--underline] [--background] [--reset]"'
    echo -e "             \t [--command=<command>]"
    set_random_color --bright -r --command='echo -e "\t\t [--light] [--dark] [--bright] [--show-colors] [--colors]"';
    set_random_color --light  -r --command='echo -e "\t\t [-0] [-1] [-2] [-3] [-4] [-5] [-6] [-7] [-8]"';
    echo "";
    echo "";
    set_random_color --light --italic;
    echo "set_random_color bold        -->   set terminal text color to bold";
    echo "set_random_color -r          -->   equivalent to set_color_normal"
    echo "set_random_color -0          -->   set terminal text background color"; 
    spaced_print_seperator;
    set_random_color --bold --background -r --command='echo " ARGUMENTS: "'
    set_random_color --italic;
    echo -e "\tbackground                - random color will be shown behind the text"               
    echo -e "\tbold                      - random color will be bold"                                      
    echo -e "\titalic                    - random color will be italic"                                  
    echo -e "\tunderline                 - random color will be underline"                            
    echo -e "\treset/normal              - random color will be reset"                  
    echo -e "\t                            (no random color)"                  
    echo -e "\tdebug                     - random color picked will be displayed" 
    echo -e "\t                            after the function finishes" 
    echo -e "\thelp                      - displays this help message"
    spaced_print_seperator;
    set_random_color --bold --background -r --command='echo " FLAGS: "'
    set_random_color --italic;
    echo -e "\t -0 -B --background       - random color will be on background"                                                                           
    echo -e "\t -1 -b --bold             - random color will be bold"                                                                                          
    echo -e "\t -2 -i --italic           - random color will be italic"                                                                                      
    echo -e "\t -3 -u --underline        - random color will be underline"                                                                                
    echo -e "\t -4 -r                    - random color will be reset"                                                            
    echo -e "\t --reset --normal           (no random color)"                                                            
    echo -e "\t -5 -e --echo=\"[STR]\"     - echo the string in a random color "
    echo -e "\t -6 -c --command=\"[CMD]\"  - run command with ouput colored. Run"
    echo -e "\t                            with -r flag to reset after"                                                 
    echo -e "\t -7 -d --dump --debug     - random color picked will be displayed"                                             
    echo -e "\t                            after function finishes"                                             
    echo -e "\t -8 -D --debug-all        - will display all local variable " 
    echo -e "\t --debug-all              - values set in this function." 
    spaced_print_seperator;
    set_random_color --bold --background -r --command='echo " COLOR PREFERENCES: "'
    set_random_color --italic;
    echo -e "\t --light              - possible random colors will be lighter"
    echo -e "\t --bright             - possible random colors will be brighter"
    echo -e "\t                        (br version, i.e. brblue)"
    echo -e "\t --dark               - possible random colors will be darker"
    echo -e "\t --colors             - display all possible colors available"
    echo -e "\t --show-colors          in fish shell"
    spaced_print_seperator;
    set_random_color --background --reset --command="echo ' SEE ALSO: '";
    set_random_color --italic;
    echo -e "\t• set_color_normal.fish"
    echo -e "\t• ~/.config/fish/completions/"
    echo -e "\t• ~/.config/fish/functions/"
    spaced_print_seperator;
    set_random_color --bold --background --reset --bright --command='echo " set_random_color.fish is located at: "';
    echo ""
    set_random_color --bold --light --italic --command='echo -e "\t ~/.config/fish/functions/set_random_color.fish"'
    echo ""
    echo ""
end

function __check_color_prefs_flag
    set -l found_flag 0;
    for i in (seq 1 (count $argv))
        set -l curr_flag (__typeof_random_color_flag $argv[$i])
        if test $curr_flag -eq 10; #bright
            #echo brred brgreen bryellow brblue brmagenta brcyan brwhite
            echo $random_color_array_bright
            return;
        else if test $curr_flag -eq 11; #light
            #echo white brcyan brmagenta brblue brgreen brwhite brred
            echo $random_color_array_light
            return;
        else if test $curr_flag -eq 12; #dark
            #echo bryellow brblack brblue brgreen black yellow blue
            echo $random_color_array_dark;
            return;
        else if test $curr_flag -eq 13; # error
            echo $random_color_array_error;
            return;
        end
    end
    #echo red green yellow blue magenta cyan white;
    echo $random_color_array_normal;
end

function __has_show_colors_flag 
    set -l sz (count $argv)
    set -l found_flag_1 0
    set -l found_flag_2 0
    if test $sz -eq 0
        return 0
    end
    for i in (seq 1 $sz)
        set -l curr_arg (args_regex_helper $argv[$i]);
        if test "$curr_arg" = "colors";or test "$curr_arg" = "show-colors";
            set found_flag_1 1;
        else if test "$curr_arg" = "bright";
            set found_flag_2 1;
        else if test "$curr_arg" = "light";
            set found_flag_2 2;
        else if test "$curr_arg" = "dark";
            set found_flag_2 3;
        else if test "$curr_arg" = "error";
            set found_flag_2 4;
        end
    end
    echo $found_flag_1
    echo $found_flag_2
end

function __print_colors 
    set -l change_color_cmd (echo "set_color --print-colors");
    spaced_print_seperator;
    #set_random_color -B -u -b -r --echo="ALL:"
    set_color --print-colors;
    spaced_print_seperator;
    set -l colors_arr (string split " " -- $random_color_array_normal)
    set -l colors_string (echo "normal")
    if test $argv -eq 1
        set colors_string (echo "bright")
        set colors_arr (string split " " -- $random_color_array_bright)
    else if test $argv -eq 2
        set colors_string (echo "light")
        set colors_arr (string split " " -- $random_color_array_light )
    else if test $argv -eq 3
        set colors_string (echo "dark")
        set colors_arr (string split " " -- $random_color_array_dark)
    else if test $argv -eq 4
        set colors_string (echo "error")
        set colors_arr (string split " " -- $random_color_array_error)
    else
        set colors_string (echo "normal")
        set colors_arr (string split " " -- $random_color_array_normal)
    end

    set -l colors_string (string upper "$colors_string colors")
    set_random_color -b -u -r --echo="$colors_string" | print_char_rainbow --inverse
    echo ""

    set -l curr_num 1;
    for current in $colors_arr
        set -l curr_idx (__get_16_color_index $current $curr_num);
        set_color "#000" --background $current --bold; echo -n "$curr_idx:";
        set_color_normal;
        set_color "#000" --background $current ; echo -n " $current";
        set_color_normal;
        echo "";
        if test $curr_num -lt (count $colors_arr)
              echo "";
        end
        set curr_num (math $curr_num + 1)
    end
    spaced_print_seperator;
end

function __get_16_color_index
    set -f num1 $argv[1]
    set -f num2 $argv[2]
    set -f colors_arr (string split " " -- $colors_16_array)
    set -l index 0
    for color in $colors_arr;
        if test "$color" = "$num1";
            echo $index;and return;
        end;
        set index (math $index + 1);
    end;
    echo $num2; and return
end

function __debug_dump_all -S
    print_spaced_seperator;

    echo " ALL_DEBUG_INFO " | print_chars_rainbow;

    print_spaced_seperator;

    set_random_color --reset --echo="cmd looks like: set_color $set_color $__random_color $special_flag"
    echo ""
    set_random_color --reset --echo="flag_amount  : "$flag_amount
    set_random_color --reset --echo="special_flag : "$special_flag
    echo ""
    set_random_color --reset --echo="cmd_is_set   : "$cmd_is_set
    set_random_color --reset --echo="cmd_after_color_change: "$cmd_after_color_change
    echo ""
    set_random_color --reset --echo="reset_flag_is_set: "$reset_flag_is_set
    set_random_color --reset --echo="debug_flag_is_set: "$debug_flag_is_set
    echo ""
    set_random_color --reset --echo="__random_color: "$__random_color
    echo ""
    print_spaced_seperator;
    set_random_color --reset --echo="function at: ~/.config/fish/functions/set_random_color.fish"
    echo "";
    set_random_color --reset --echo="completions at: ~/.config/fish/completions/set_random_color.fish"
    echo "";
    set_random_color --reset --echo="flags: [0-8], [b,B,i,u,n,h,c,d], [background, bold, italic, reset, normal, debug]"
    echo "";
    set_random_color --reset --echo="flags: [0-8], [b,B,i,u,n,h,c,d], [background, bold, italic, reset, normal, debug]"

    print_spaced_seperator;

    echo "notes" | print_chars_rainbow; echo "";
    echo "• tab completions are enabled";
    echo "• use help flag";
    print_spaced_seperator;
end

for i in $random_color_array_normal
    echo "$i"
    if test "$i" = "1"
        while test $i -lt 20
            echo "$i"
            set_random_color --reset --echo="flags: [0-8], [b,B,i,u,n,h,c,d], [background, bold, italic, reset, normal, debug]"
            echo "• use help flag";
            print_spaced_seperator;
        end
    else if test "$i" = '2'
        while test $i -lt 20
            echo "$i"
            set_color_normal
            echo "• use help flag";
            print_spaced_seperator;
        end
    else 
        set_random_color
    end
end

begin;
    set -l upper_limit (count $argv)
    for i in (seq 1 $upper_limit)
        set -l curr_flag $argv[$i]
        set -l curr_flag_type (__typeof_random_color_flag $curr_flag)
        if test $curr_flag_type -eq 7;
            set -l cmd_idx (math $i)
            echo $argv[$cmd_idx..-1]; return;
        else if test $curr_flag_type -eq 5 -o $curr_flag_type -eq 6
            set curr_flag (string replace -ra '"' "" -- $curr_flag)
            set curr_flag (string replace -ra "'" "" -- $curr_flag)
            set curr_flag (string replace -ra ".*=" "" -- $curr_flag)
            set curr_flag (string trim --left $curr_flag)
            if test $curr_flag_type -eq 5 ;
                echo 'echo -e "$curr_flag"';
            else 
                echo "$curr_flag";
            end
        end
    end
end;
