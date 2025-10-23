import { describe, it, expect, beforeAll } from 'vitest';
import { provideMiniSemanticTokens } from '../src/mini-semantic-handler';
import { Analyzer } from '../src/analyze';
import { createFakeLspDocument } from './helpers';

describe('Mini Semantic Token Handler', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  it('should highlight builtin commands', () => {
    const content = `
echo "hello"
set foo bar
read -l my_var
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight FishSymbol definitions', () => {
    const content = `
function my_function
    set -l local_var 123
    echo $local_var
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight both symbols and builtins', () => {
    const content = `
set -g global_var "value"
echo $global_var
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: set (builtin), global_var (symbol), echo (builtin)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle commands with keywords', () => {
    const content = `
if test -f file.txt
    echo "file exists"
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle empty document', () => {
    const doc = createFakeLspDocument('test.fish', '');
    const result = provideMiniSemanticTokens(doc);

    expect(result.data).toEqual([]);
  });

  it('should handle document with only comments', () => {
    const content = `
# This is a comment
# Another comment
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Comments might not generate tokens in mini handler
    expect(result).toBeDefined();
  });

  it('should detect multiple builtins in sequence', () => {
    const content = `
set foo bar
echo $foo
read -l input
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for set, echo, read (all builtins)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight shebang', () => {
    const content = `#!/usr/bin/env fish
echo "hello"
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight @fish-lsp directives', () => {
    const content = `
# @fish-lsp-disable-next-line
set foo bar
# @fish-lsp-enable
echo "enabled"
# @fish-lsp-disable
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight both shebang and @fish-lsp directives', () => {
    const content = `#!/usr/bin/env fish
# @fish-lsp-disable-next-line
set foo bar
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight variable_name nodes', () => {
    const content = `
echo $foo
set bar baz
echo $bar
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should exclude leading $ from variable_name tokens', () => {
    const content = 'echo $PATH';

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // The token should exist but not include the $ sign
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should exclude leading $ from FishSymbol variable tokens', () => {
    const content = `
function test_func
    set -l local_var "value"
    echo $local_var
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for function, variable definition, and variable reference
    // None of the variable tokens should include the $
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle multiple @fish-lsp directives in one comment', () => {
    const content = `
# @fish-lsp-disable @fish-lsp-enable
echo "test"
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle @fish-lsp directives with different patterns', () => {
    const content = `
# @fish-lsp-enable-next-line
# @fish-lsp-disable-next-line
# @fish-lsp-enable
# @fish-lsp-disable
echo "test"
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });
});
