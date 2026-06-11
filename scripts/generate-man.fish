#!/usr/bin/env fish
#
# Generate the fish-lsp(1) man page from docs/MAN_FILE.md.
#
#   generate-man.fish [--write]   regenerate and overwrite man/fish-lsp.1 (default)
#   generate-man.fish --stdout    print the post-processed man page to stdout
#
# marked-man converts the markdown to roff; scripts/man-postprocess.awk then
# rewrites it into fish-style formatting (see that file for details). Both modes
# share the exact same pipeline, so `--stdout` shows precisely what `--write`
# would commit.

argparse stdout write -- $argv
or exit 1

set -l src ./docs/MAN_FILE.md
set -l dest ./man/fish-lsp.1
set -l post ./scripts/man-postprocess.awk

set -l tmp (mktemp)
npx marked-man --gfm --breaks --lang-prefix=fish --smart-lists \
    --date (date) --manual fish-lsp --section 1 -i $src 2>/dev/null \
    | awk -f $post \
    | awk '/./ { for (; blank > 0; blank--) print ""; print; next } { blank++ }' >$tmp

if set -q _flag_stdout
    cat $tmp
    rm -f $tmp
else
    mkdir -p ./man
    mv $tmp $dest
end
