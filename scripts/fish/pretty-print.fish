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

function icon_check -d 'Check icon'
    printf %s '  '
end
function icon_x -d 'Cross icon'
    printf %s '  '
end
function icon_warning -d 'Warning icon'
    printf %s '  '
end
function icon_info -d 'Information icon'
    printf %s '  '
end
function icon_question -d 'Question icon'
    printf %s '  '
end
function icon_folder -d 'Folder icon'
    printf %s '  '
end
function icon_file -d 'File icon'
    printf %s '  '
end

# helpers

# @fish-lsp-disable 4004
function print_separator -d '\\<hr \/\\>'
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

# A general logging function with various options to customize the output
#
# USAGE:
#  log_msg [OPTIONS] [TITLE] MESSAGE
#
# EXAMPLES:
#  >_ log_msg --info "This is an informational message"
#  `       [INFO]      This is an informational message`
#
#  >_ log_msg --fail "Low disk space" --exit
#  `       [WARNING]   Low disk space`
#      exits with status 1
#
function log_msg -d 'Print log message'
    argparse --ignore-unknown \
        -x w,e,i,d \
        -x success,failure \
        w/warning e/error i/info d/debug \
        'icon=?' 't/title=?' 'm/message=?' \
        'theme=?' date \
        pass passed success fail failed failure exit \
        h/help -- $argv
    or return 1

    if set -ql _flag_pass || set -ql _flag_passed || set -ql _flag_success
        set -f _flag_success 1
    end

    if set -ql _flag_fail || set -ql _flag_failed || set -ql _flag_failure
        set -f _flag_failure 1
    end

    if set -q _flag_help
        echo \
'Usage: log_msg [OPTIONS] [TITLE] MESSAGE

Options:
    -w, --warning                    Set log level to WARNING
    -e, --error                      Set log level to ERROR
    -i, --info                       Set log level to INFO
    -d, --debug                      Set log level to DEBUG
    --icon ICON                      Specify a custom icon
    --title TITLE                    Specify a custom title
    --message MESSAGE                Specify a custom message
    --theme THEME                    Specify a theme
    --date                           Prepend the current date and time to the message
    --success, --pass, --passed      Print message in passed style
    --failure, --fail, --failed      Print message in failed style
    --exit                           Exit after printing the message
    --help                           Show this help message

Arguments:
    TITLE                 The title of the log message (optional if --title is used)
    MESSAGE               The log message content

Examples:
    >_ log_msg "TITLE" "MESSAGE"
            [TITLE]     MESSAGE

    >_ log_msg --success "Operation completed successfully"
           [OK]        Operation completed successfully

    >_ log_msg --info "This is an informational message"
           [INFO]      This is an informational message

    >_ log_msg --warning "Low disk space"
           [WARNING]   Low disk space

    >_ log_msg --fail --error "Failed to connect to server"
           [ERROR]     Failed to connect to server
        # Exits with status 1

    >_ log_msg --date --debug "Debugging application"
           [DEBUG]     [2024-06-01 12:34:56] Debugging application'
        return 0
    end

    set icon ''
    set title ''
    set message ''
    set theme ''
    set remaining_args (count $argv)

    if set -q _flag_warning
        set icon (icon_warning)
        set title '[WARNING]'
        set theme "$YELLOW"
    else if set -q _flag_error
        set icon (icon_x)
        set title '[ERROR]'
        set theme "$RED"
    else if set -q _flag_info
        set icon (icon_info)
        set title '[INFO]'
        set theme "$BLUE"
    else if set -q _flag_debug
        set icon (icon_question)
        set title '[DEBUG]'
        set theme "$MAGENTA"
    else if set -q _flag_success
        set icon (icon_check)
        set title '[SUCCESS]'
        set theme "$GREEN"
    else if set -q _flag_failure
        set icon (icon_x)
        set title '[FAILURE]'
        set theme "$RED"
    end

    if set -q _flag_icon
        switch $_flag_icon
            case 'check'
                set icon (icon_check)
            case 'x'
                set icon (icon_x)
            case 'warning'
                set icon (icon_warning)
            case 'info'
                set icon (icon_info)
            case 'question'
                set icon (icon_question)
            case 'folder'
                set icon (icon_folder)
            case 'file'
                set icon (icon_file)
            case '*'
                set icon $_flag_icon
        end
    end

    test -z "$icon" && set icon (icon_info)
    
    set -q _flag_title && set title $_flag_title
    set -q _flag_message && set message $_flag_message
    set -q _flag_theme && set theme $NORMAL$_flag_theme

    if test $remaining_args -eq 2
        if test -z "$title"
            set title $argv[1]
            set message $argv[2]
        else
            set message (string join ':' -n -- $(string upper -- $argv[1]) $argv[2])
        end
    else if test $remaining_args -eq 1
        set message $argv[1]
    end

    if set -q _flag_date
        set message (string join ' ' -- \
            (echo "$message$NORMAL" | string pad --width 35 --right --char ' ') \
            "$WHITE$BG_BLACK$REVERSE $(date '+%Y-%m-%d %H:%M:%S') $NORMAL"
        )
    end

    if test -n "$title" 
        set title (string trim -- $title | string upper)
        if string match -rvq -- '\[.*\]' "$title"
            set title "[$(string upper -- $title)]"
        end
    end


    string join -n ' ' -- $(echo "  $NORMAL$theme$BG_BLACK$REVERSE  $icon $NORMAL$theme" | string pad --width 7 --right --char " " ) \
        (string pad --width 5 -- ' ') \
        (string pad --width 15 --right --char ' ' -- "$theme$BOLD$title$NORMAL") \
        "$NORMAL$theme$message$NORMAL"

    set -q _flag_exit && exit 1
end
