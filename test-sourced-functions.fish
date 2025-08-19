#!/usr/bin/env fish

# Source the pretty-print functions
source $PWD/scripts/pretty-print.fish
source ./scripts/continue_or_exit.fish

# Test function that uses sourced functions
function test_sourced_functions
    # These functions should be resolved by the LSP
    log_info "🧪" "[TEST]" "Testing sourced function resolution"
    print_success "This should resolve to pretty-print.fish"
    reset_color

    continue_or_exit
    
    # These variables should also be resolved
    echo $GREEN"Green text"$NORMAL
    echo $BLUE"Blue text"$NORMAL
end

# Call the test function
test_sourced_functions
