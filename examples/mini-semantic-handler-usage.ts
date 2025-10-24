/**
 * Example usage of the mini semantic token handler
 *
 * This demonstrates how to use the provideMiniSemanticTokens function
 * to get semantic highlighting for Fish shell scripts.
 */

import { provideMiniSemanticTokens } from '../src/mini-semantic-handler';
import { Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';

async function example() {
  // Initialize the analyzer (required before using the handler)
  await Analyzer.initialize();

  // Create a sample Fish script
  const fishScript = `
function greet
    set -l name $argv[1]
    echo "Hello, $name!"
end

if test -f ~/.config/fish/config.fish
    source ~/.config/fish/config.fish
end

set -gx PATH /usr/local/bin $PATH
  `.trim();

  // Create an LspDocument from the script
  const uri = 'file:///tmp/example.fish';
  const document = LspDocument.createTextDocumentItem(uri, fishScript);

  // Get semantic tokens
  const tokens = provideMiniSemanticTokens(document);

  console.log('Semantic tokens generated:', tokens.data.length, 'tokens');

  // The tokens.data array contains the encoded semantic token information
  // Each token is encoded as 5 integers: [deltaLine, deltaStart, length, tokenType, tokenModifiers]
  return tokens;
}

// Run the example
if (require.main === module) {
  example().then(tokens => {
    console.log('Success! Generated', tokens.data.length / 5, 'semantic tokens');
  }).catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

export { example };
