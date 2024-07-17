#!/usr/bin/env fish


# Relink a globally installed package to the local package
# that was called by this script. If the global package
# is not installed, it will be installed globally.
# Use this for testing changes to the fish-lsp package.

# Usage: ./relink-locally.sh

argparse --max-args 1 h/help q/quiet v/verbose no-stderr -- $argv
or return

if set -q _flag_help
    echo 'NAME:'
    echo '   relink-locally.fish'
    echo ''
    echo 'DESCRIPTION:'
    echo '   Handle relinking pkg. Default usage silences any subshell relinking output.'
    echo '   Option \'-q,--quiet\' (silence all subsubshell output), is assumed for'
    echo '   usage without an option.'
    echo ''
    echo 'OPTIONS:'
    echo -e '   -q,--quiet\tsilence all [DEFAULT]'
    echo -e '   -v,--verbose\tno silencing subshells'
    echo -e '   --no-stderr\tsilence stderr in subshells'
    echo -e '   -h,--help\tshow this message'
    return 0
end

if set -q _flag_no_stderr
    # show all sub shells w/ only stdout
    if command -vq fish-lsp
        echo '    "fish-lsp" is already installed'
        echo '    UNLINKING and LINKING again'
        yarn unlink --global fish-lsp 2>/dev/null
        yarn global remove fish-lsp 2>/dev/null
    end
    yarn link --global fish-lsp --force 2>/dev/null
    echo 'SUCCESS! "fish-lsp" is now installed and linked'
    return 0

else if set -q _flag_verbose

    # show all sub shells w/ stdout stderr
    if command -vq fish-lsp
        echo '    "fish-lsp" is already installed'
        echo '    UNLINKING and LINKING again'
        yarn unlink --global fish-lsp
        or return 1
        yarn global remove fish-lsp
        or return 1
    end
    yarn link --global fish-lsp --force
    and echo 'SUCCESS! "fish-lsp" is now installed and linked'


    return $status

else
    # silence all sub shells (don't include stdout & stderr) 
    # occurs when: ZERO flags given or $_flag_quiet
    echo "RELINKING 'fish-lsp' GLOBALLY..."
    if command -vq fish-lsp
        echo '    "fish-lsp" is already installed'
        echo '    UNLINKING and LINKING again'
        yarn unlink --global fish-lsp &>/dev/null
        yarn global remove fish-lsp &>/dev/null
    end
    yarn link --global fish-lsp --force &>/dev/null

    echo -e 'SUCCESS! "fish-lsp" is now installed and linked'
    return 0

end