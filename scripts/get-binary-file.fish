#!/usr/bin/env fish

source ./scripts/pretty-print.fish

argparse h/help print-binary-file d/debug export-path -- $argv
or return

set -gx pkg_json_bin (yarn exec -s node-jq -- -r '.bin | .[]' package.json | path resolve)
if not test -f $pkg_json_bin
    set -gx pkg_json_bin (yarn -s exec -- fish-lsp info --bin)
end

function get_fish_lsp_bin_entry --description 'Get the binary file for fish-lsp'
    set cmds (yarn exec -s node-jq -- -r '.bin | .[]' package.json | path resolve) (yarn -s exec -- fish-lsp info --bin)
    for cmd in $cmds
        test -z "$cmd" && continue
        set cmd (path resolve -- $cmd)
        if test -f $cmd
            echo $cmd
            return 0
        end
    end
    return 1
end

if set -q _flag_export_path
    fish_add_path --global --prepend "$(echo $pkg_json_bin)"
    echo $PATH
    return 0
end

if set -q _flag_help
    echo 'NAME:'
    echo "   ./scripts/get-binary-file.fish"
    echo ''
    echo 'DESCRIPTION:'
    echo '   Get the fish-lsp binary file from package.json or via yarn exec.'
    echo ''
    echo 'OPTIONS:'
    echo -e '   -h,--help\tshow this message'
    echo -e '   -d,--debug\tprint debug information'
    echo -e '   --print-binary-file\tprint the fish-lsp binary file path'
    echo ''
    echo 'EXAMPLES:'
    echo -e '  >_ source ./scripts/get-binary-file.fish'
    echo -e '  >_ echo $pkg_json_bin'
    echo -e '  >_ get_fish_lsp_bin_entry'
    echo -e '  Variable and function both expose the `package.json` bin entry'
    echo -e ''
    echo -e '  >_ set -gx pkg_json_bin (yarn exec -s node-jq -- -r \'.bin | .[]\' package.json | path resolve)'
    echo -e '  >_ set -gx pkg_json_bin (yarn -s exec -- fish-lsp info --bin)'
    echo -e '  Pretty much whats going on under the hood.'
    echo -e ''
    echo -e '  >_ source ./scripts/get-binary-file.fish'
    echo -e '  >_ get_fish_lsp_bin_entry'
    echo -e '  Source the script in any other `scripts/*.fish` file to reuse this utility\n'
    return 0
end

if set -q _flag_print_binary_file
    if test -n "$pkg_json_bin" -a -f "$pkg_json_bin"
        set -ql _flag_debug
        and log_info "" "[INFO]" "Found fish-lsp binary file: $pkg_json_bin" >&2
        echo $pkg_json_bin
        return 0
    end
    get_fish_lsp_bin_entry 1>/dev/null
    if test $status -ne 0
        set -ql _flag_debug
        and log_error "" "[ERROR]" "Could not find the fish-lsp binary file in `package.json` or via `yarn exec`." >&2
        return 1
    end
    if test -n "$pkg_json_bin" -a -f "$pkg_json_bin"
        set -gx pkg_json_bin (get_fish_lsp_bin_entry)
        set -ql _flag_debug
        and log_info "" "[INFO]" "Found fish-lsp binary file: $pkg_json_bin"
        echo $pkg_json_bin
        return 0
    else
        set -ql _flag_debug
        and log_error "" "[ERROR]" "Could not find the fish-lsp binary file." >&2
        return 1
    end
end


