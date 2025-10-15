#!/usr/bin/env fish
# Test file for operator semantic tokens

# -- operator (already in highlights as it seems)
echo test -- this is after -- >> output.txt

# Pipe and redirect operators
ls | grep test
ls >output.txt
ls >>append.txt
ls 2>error.txt
ls &>all.txt
ls | tee /output/a

# Fish LSP directive comments with nested keywords
# @fish-lsp-disable
echo "disabled diagnostics" >&2
# @fish-lsp-enable

# @fish-lsp-disable-next-line
echo "next line disabled"
# @fish-lsp-disable

echo "enabled specific codes"

echo "$( set qux b)"
set --local bar --baz -- \
    qux

argparse h/help -- $argv
or return

baz a d e -g

command alias arg2 --option=value\ a b
# { 
#     echo "inside block";
#     echo "still inside block"
# }

if test $var -eq 1; and echo "var is 1"; or echo "var is not 1"; 

else
    foo
end

export bar=~/bas/baz
set -gx qux (foo --bar baz)
echo (seq 1 10)

fish_add_path -o=/tmp/path -v=1
and echo "file exists"


alias fa=foo
alias ga='grep --color=auto'
alias la 'ls -lah'
abbr -a aaa ~/foo/ba/a


[ -f /etc/fish/config.fish ]; and echo "config exists"
foo=b b

if foo

else if bar

else 

end
