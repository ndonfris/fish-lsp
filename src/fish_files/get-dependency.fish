#!/usr/bin/fish



set -l filepath (functions --all -D "$argv" 2>> /dev/null)

switch $filepath
    case 'n/a'
        echo ""
        return 0
    case \*
        echo "$filepath"
        return 0
end
