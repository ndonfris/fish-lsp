function reset_color
    set_color normal
end

set -gx NORMAL (set_color normal)
set -gx GREEN (reset_color && set_color green)
set -gx BLUE (reset_color && set_color blue)
set -gx RED (reset_color && set_color red)
set -gx YELLOW (reset_color && set_color yellow)
set -gx CYAN (reset_color && set_color cyan)
set -gx MAGENTA (reset_color && set_color magenta)
set -gx WHITE (reset_color && set_color white)
set -gx BLACK (reset_color && set_color black)

set -gx BOLD_GREEN (reset_color && set_color green --bold)
set -gx BOLD_BLUE (reset_color && set_color blue --bold)
set -gx BOLD_RED (reset_color && set_color red --bold)
set -gx BOLD_YELLOW (reset_color && set_color yellow --bold)
set -gx BOLD_CYAN (reset_color && set_color cyan --bold)
set -gx BOLD_MAGENTA (reset_color && set_color magenta --bold)
set -gx BOLD_WHITE (reset_color && set_color white --bold)
set -gx BOLD_BLACK (reset_color && set_color black --bold)

set -gx UNDERLINE_GREEN (reset_color && set_color green --underline)
set -gx UNDERLINE_BLUE (reset_color && set_color blue --underline)
set -gx UNDERLINE_RED (reset_color && set_color red --underline)
set -gx UNDERLINE_YELLOW (reset_color && set_color yellow --underline)
set -gx UNDERLINE_CYAN (reset_color && set_color cyan --underline)
set -gx UNDERLINE_MAGENTA (reset_color && set_color magenta --underline)
set -gx UNDERLINE_WHITE (reset_color && set_color white --underline)
set -gx UNDERLINE_BLACK (reset_color && set_color black --underline)

# @fish-lsp-disable 4004
function icon_check -d 'Check icon'
    printf %s ' '
end
function icon_x -d 'Cross icon'
    printf %s ' '
end
function icon_warning -d 'Warning icon'
    printf %s ' '
end
function icon_info -d 'Information icon'
    printf %s ' '
end
function icon_question -d 'Question icon'
    printf %s ' '
end
function icon_folder -d 'Folder icon'
    printf %s ' '
end
function icon_file -d 'File icon'
    printf %s ' '
end

# helpers

function print_separator -d '<hr />'
    string repeat --count=80 -- '─'
end

function print_success -d 'Print success message'
    echo $BOLD_GREEN"$(icon_check)SUCCESS: $GREEN$argv"$NORMAL
end

function print_failure -d 'Print failure message'
    echo $BOLD_RED"$(icon_x)FAILURE: $RED$argv"$NORMAL >&2
end

function print_error -d 'Print error message'
    echo $BOLD_RED"$(icon_x)ERROR: $RED$argv"$NORMAL >&2
end
