#!/usr/bin/env fish

# Test the EXACT scenario from publish-nightly.fish
source ./scripts/continue_or_exit.fish
source ./scripts/pretty-print.fish

function test_real_scenario
    # These should now be resolved by the LSP with relative paths
    log_info "🧪" "[TEST]" "Testing real relative path scenario"
    continue_or_exit "Do you want to continue testing?"
    print_success "Relative path resolution is working!"
end

test_real_scenario