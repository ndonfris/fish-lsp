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

set -gx BOLD (set_color --bold)
set -gx REVERSE (set_color --reverse)
set -gx UNDERLINE (set_color --underline)
set -gx ITALIC (set_color --italics)
set -gx ITALICS (set_color --italics)
set -gx DIM (set_color --dim)

set -gx BRIGHT_GREEN (set_color brgreen)
set -gx BRIGHT_BLUE (set_color brblue)
set -gx BRIGHT_RED (set_color brred)
set -gx BRIGHT_YELLOW (set_color bryellow)
set -gx BRIGHT_CYAN (set_color brcyan)
set -gx BRIGHT_MAGENTA (set_color brmagenta)
set -gx BRIGHT_WHITE (set_color brwhite)
set -gx BRIGHT_BLACK (set_color brblack)

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

set -gx BG_GREEN (set_color --background green)
set -gx BG_BLUE (set_color --background blue)
set -gx BG_RED (set_color --background red)
set -gx BG_YELLOW (set_color --background yellow)
set -gx BG_CYAN (set_color --background cyan)
set -gx BG_MAGENTA (set_color --background magenta)
set -gx BG_WHITE (set_color --background white)
set -gx BG_BLACK (set_color --background black)

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

function log_info -d 'Print success message' -a icon title message
    set result 
    if test -n "$icon"
        set -a result (string pad --width 5 --right --char ' ' -- " $WHITE$icon$NORMAL")
    end

    if test -n "$title"
        set -a result (string pad --width 10 --right --char ' ' -- "$BOLD_GREEN$title$NORMAL")
    end

    if test -n "$message"
        set -a result "$CYAN$message$NORMAL"
    end

    string join ' ' -- $result
end

function log_warning -d 'Print warning message' -a icon title message
    set -l result

    if test -n "$icon"
        set -a result (string pad --width 5 --right --char ' ' -- " $YELLOW$icon$NORMAL")
    end

    if test -n "$title"
        set -a result (string pad --width 10 --right --char ' ' -- "$BOLD_YELLOW$title$NORMAL")
    end

    if test -n "$message"
        set -a result "$YELLOW$message$NORMAL"
    end

    string join ' ' -- $result
end

function log_error -d 'Print error message' -a icon title message
    set -l result

    if test -n "$icon"
        set -a result (string pad --width 5 --right --char ' ' -- " $WHITE$icon$NORMAL")
    end

    if test -n "$title"
        set -a result (string pad --width 10 --right --char ' ' -- "$BOLD_RED$title$NORMAL")
    end

    if test -n "$message"
        set -a result "$RED$message$NORMAL"
    end

    string join ' ' -- $result
end

function success -d 'Print success message'
    set icon (icon_check)
    log_info "$icon" '[OK]' "$argv"
end

function fail -d 'Print error message and exit'
    set icon (icon_x)
    log_error "$icon" '[ERROR]' "$argv"
    exit 1
end
