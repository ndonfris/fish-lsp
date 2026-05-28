#!/usr/bin/env fish

source ./scripts/fish/pretty-print.fish
source ./scripts/fish/continue-or-exit.fish

log_info '  ' '[RUN]' 'Update `docs/CHANGELOG.md` SCRIPT'
print_separator
log_info 'ℹ️' '[INFO]' 'Dry run of how the `docs/CHANGELOG.md` will be updated...'
print_separator
yarn -s util:update-changelog:dry:diff 2>/dev/null
print_separator

# continue_or_exit --quiet --prepend-prompt='This will update the `./docs/CHANGELOG.md`. Do you want to continue?' --prompt-str='(y/n)?'
if not continue_or_exit --time-in-prompt --quiet --prepend-prompt='This will update the `./docs/CHANGELOG.md`. Do you want to continue?' --prompt-str="$GREEN$BOLD$UNDERLINE$REVERSE(y/n)?$NORMAL"' ' || false
    log_warning '⚠️' '[WARNING]' 'SKIPPING `docs/CHANGELOG.md` UPDATE'
else
    yarn util:update-changelog
    log_info '✅' '[INFO]' 'UPDATED `docs/CHANGELOG.md`'
end
print_separator
