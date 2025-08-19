#!/usr/bin/env node

// Simple test script to verify our changes work
const { readFileSync } = require('fs');
const { resolve } = require('path');

// This simulates what the LSP server does internally
console.log('Testing fish-lsp sourced function resolution...');

// Test script content with sourcing
const testScript = `#!/usr/bin/env fish

source ${resolve(__dirname, 'scripts/pretty-print.fish')}

function test_function
    log_info "test" "message" "content"
end
`;

console.log('Test script:');
console.log(testScript);
console.log('\nIf this was working in the LSP:');
console.log('1. log_info should be resolvable via go-to-definition');
console.log('2. log_info should appear in document symbols');
console.log('3. log_info should be available in autocompletion');
console.log('\nNext steps:');
console.log('1. Make sure your editor restarted the LSP server');
console.log('2. Test with the test-sourced-functions.fish file');
console.log('3. Check your editor\'s LSP logs for any errors');