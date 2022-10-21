#!/usr/bin/fish 

function backup_input 
    set -a -l _fish_lsp_file_cmps (fish -c "complete --do-complete '$argv -' | uniq") (fish -c "complete --do-complete '$argv ' | uniq") 

    for _fish_lsp_cmp in $_fish_lsp_file_cmps
        echo "$_fish_lsp_cmp"
    end
    return 0;
    and exit
end



# file is just used to get command options
# not used for tokens other than one needing a commandline completion

if test (count $argv) -ge 2
    fish -c "complete --do-complete '$argv' | uniq"
else 
    backup_input $argv
end


