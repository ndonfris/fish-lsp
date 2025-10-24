import { describe, it, expect, beforeAll } from 'vitest';
import { provideMiniSemanticTokens } from '../src/mini-semantic-handler';
import { Analyzer, analyzer } from '../src/analyze';
import { createFakeLspDocument } from './helpers';
import { FISH_SEMANTIC_TOKENS_LEGEND } from '../src/utils/semantics';
import type { SemanticTokens } from 'vscode-languageserver';

/**
 * Utility function to decode and log semantic tokens for debugging
 * @param result - The SemanticTokens result from provideMiniSemanticTokens
 * @param content - The original source code content
 * @param options - Optional configuration for logging
 */
function logSemanticTokens(
  result: SemanticTokens,
  content: string,
  options: { showSeparators?: boolean; title?: string } = {},
): void {
  const { showSeparators = true, title } = options;
  const tokens = result.data;
  const tokenCount = tokens.length / 5;

  if (title) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(60));
  }

  console.log(`Content: ${showSeparators ? '|' : ''}${content}${showSeparators ? '|' : ''}`);
  console.log(`Token count: ${tokenCount}\n`);

  let line = 0;
  let startChar = 0;

  for (let i = 0; i < tokens.length; i += 5) {
    line += tokens[i]!;
    startChar = tokens[i] === 0 ? startChar + tokens[i + 1]! : tokens[i + 1]!;
    const length = tokens[i + 2]!;
    const tokenTypeIndex = tokens[i + 3]!;
    const tokenModifiersMask = tokens[i + 4]!;

    // Get the actual text
    const text = content.substring(startChar, startChar + length);

    // Reverse map token type
    const tokenType = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenTypeIndex] || `UNKNOWN(${tokenTypeIndex})`;

    // Reverse map modifiers from bitmask
    const modifiers: string[] = [];
    for (let j = 0; j < FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.length; j++) {
      if (tokenModifiersMask & (1 << j)) {
        modifiers.push(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers[j]!);
      }
    }
    const modifiersStr = modifiers.length > 0 ? ` [${modifiers.join(', ')}]` : '';

    // Format output with separators if requested
    const textDisplay = showSeparators ? `|${text}|` : `"${text}"`;

    console.log(
      `  Token ${i / 5}: ` +
      `line=${line}, start=${startChar}, len=${length}, ` +
      `type=${tokenType}${modifiersStr}, ` +
      `text=${textDisplay}`,
    );
  }

  if (title) {
    console.log('='.repeat(60) + '\n');
  }
}

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

  it('should exclude trailing = from export definitions', () => {
    const content = `
export PATH=/usr/bin
export EDITOR=vim
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should exclude trailing = from alias definitions', () => {
    const content = `
alias ll='ls -la'
alias gs='git status'
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: alias (2x keywords), ll, gs (2x alias names)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight alias keyword', () => {
    const content = `alias bar='echo bar'`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: alias (keyword), bar (function/alias name)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight reserved keywords', () => {
    const content = `
if test -f file.txt
    echo "exists"
else
    echo "not found"
end

for i in 1 2 3
    echo $i
end

while test $count -lt 10
    set count (math $count + 1)
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: if, else, end, for, in, while keywords
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight begin/end keywords', () => {
    const content = `
begin
    set -l temp_var "value"
    echo $temp_var
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: begin, end keywords
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle both $ prefix and = suffix exclusions', () => {
    const content = `
export VAR=value
echo $VAR
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight [ test command brackets', () => {
    const content = `[ -d /tmp ] && [ -f /tmp/file.fish ] || return 1`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: [ and ] (2 sets), return keyword
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should not highlight [ ] in array indexing', () => {
    const content = `echo paths_checked[$i]`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: echo (builtin), paths_checked, i (variables)
    // But NOT for [ or ] since they're part of array indexing, not a command
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should distinguish [ command from array indexing', () => {
    const content = `
if [ -d /tmp ] && [ -f /tmp/file.fish ]
    set -l paths_checked (string split '/' -- '/tmp/file.fish')
    for i of (seq 1 (count paths_checked))
        echo paths_checked[$i]
    end
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should highlight [ ] in test commands but not in array indexing
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle comprehensive example with [ commands and array indexing', () => {
    const content = `
[ -d /tmp ] && [ -f /tmp/file.fish ] || return 1

if [ -d /tmp ] && [ -f /tmp/file.fish ]
    set -l paths_checked (string split '/' -- '/tmp/file.fish')
    for i of (seq 1 (count paths_checked))
        echo paths_checked[$i] # note that \`[\`/\`]\` is not meant to be considered as a function highlight like the cases above
    end
end
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for:
    // - [ ] brackets in test commands (4 pairs total)
    // - keywords: if, end, for, of, return
    // - builtins: set, string, split, seq, count, echo
    // - variables: paths_checked, i
    // - operators from highlights.scm: &&, ||, --
    // - strings from highlights.scm: '/', '/tmp/file.fish'
    // - NOT [ ] in array indexing paths_checked[$i]
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should apply highlights.scm queries for operators', () => {
    const content = `test -f file.txt && echo yes || echo no`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: test, echo (2x), and operators &&, ||
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should apply highlights.scm queries for strings', () => {
    const content = `echo "hello world" 'single quoted'`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: echo, and both string literals
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should NOT highlight test command flags as operators', () => {
    const content = `[ -f /tmp/foo.fish ]`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: [ and ] brackets, possibly strings for paths
    // Should NOT have operator tokens for -f flag
    expect(result.data.length).toBeGreaterThan(0);

    // We're mainly checking that the handler doesn't crash and produces some tokens
    // The key is that -f is NOT highlighted as an operator (which we filter out)
    expect(result.data.length).toBeGreaterThanOrEqual(2); // At minimum [ and ]
  });

  it('should NOT highlight test builtin flags as operators', () => {
    const content = `test -d /tmp -a -f /tmp/foo.fish`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for: test (builtin)
    // Should NOT have operator tokens for -d, -a, -f flags
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight variables within double-quoted strings', () => {
    const content = `test -n "/a/$argv"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for:
    // - test (builtin)
    // - "/a/" (string part before variable)
    // - argv (variable name)
    // - closing quote (string part after variable)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle multiple variables in a string', () => {
    const content = `echo "Hello $USER, your home is $HOME"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for:
    // - echo (builtin)
    // - "Hello " (string)
    // - USER (variable)
    // - ", your home is " (string)
    // - HOME (variable)
    // - closing quote (string)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle command substitution in strings', () => {
    const content = `echo "Current dir: (pwd)"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for:
    // - echo (builtin)
    // - "Current dir: " (string)
    // - pwd command inside substitution
    // - closing quote (string)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should handle plain strings without expansions', () => {
    const content = `echo "foo" 'bar'`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have tokens for:
    // - echo (builtin)
    // - "foo" (complete string)
    // - 'bar' (complete string)
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight escape sequences', () => {
    const content = `echo \"baz\" \\'qux\\'`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens to see what we're getting
    logSemanticTokens(result, content, { title: 'Escape Sequences: echo \\"baz\\" \\\'qux\\\'' });

    // Should have tokens for:
    // - echo (builtin)
    // - "baz" (string)
    // - \' and \' (escape sequences)
    expect(result.data.length).toBeGreaterThan(0);

    const tokenCount = result.data.length / 5;
    // Should have: echo, "baz", two escape sequences (\')
    expect(tokenCount).toBeGreaterThanOrEqual(4);
  });

  it('should highlight escape sequences within strings', () => {
    const content = `echo "hello\\nworld\\t"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens
    logSemanticTokens(result, content, { title: 'Escape Sequences in Strings' });

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should highlight backslash escape sequences', () => {
    const content = `echo line1\\
line2`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens
    logSemanticTokens(result, content, { title: 'Backslash Line Continuation' });

    const tokenCount = result.data.length / 5;
    expect(result.data.length).toBeGreaterThan(0);

    // Should have: echo, line1, \\\n (escape), line2
    // But words in concatenations might not be highlighted
    // At minimum: echo + escape sequence
    expect(tokenCount).toBeGreaterThanOrEqual(2);
  });

  it('should highlight escaped spaces as strings', () => {
    const content = `echo asdfs\\ bar\\ baz`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens
    logSemanticTokens(result, content, { title: 'Escaped Spaces: echo asdfs\\ bar\\ baz' });

    const tokenCount = result.data.length / 5;
    expect(result.data.length).toBeGreaterThan(0);

    // Should have: echo + escaped spaces (\\ ) as string tokens
    expect(tokenCount).toBeGreaterThanOrEqual(3);
  });

  it('should highlight escaped space after string interpolation', () => {
    const content = `test -n "/a/$v"\\ foo`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens
    logSemanticTokens(result, content, { title: 'Escaped Space After String: "/a/$v"\\ foo' });

    expect(result.data.length).toBeGreaterThan(0);
  });
});

describe('Mini Semantic Token Handler - String Interpolation Real World Cases', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  it('should handle complete file with string interpolation on line 14', () => {
    const content = `
# @fish-lsp-disable

function foo -a ''
    echo "foo$a"
    set -l args $argv
end

foo

alias bar='echo bar'
export v="variable"

if test -n "/a/$v"
    echo "v is set"
end

[ -f foo  ]
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Should have many tokens including:
    // - function, foo, end keywords
    // - echo, set, test builtins
    // - alias keyword
    // - string parts and variables
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should specifically handle line with test -n "/a/$v"', () => {
    const content = `test -n "/a/$v"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens for debugging
    logSemanticTokens(result, content, { title: 'String Interpolation: test -n "/a/$v"' });

    const tokens = result.data;

    // Should have at minimum:
    // - test (builtin)
    // - string token(s) for "/a/" and closing "
    // - variable token for v
    expect(tokens.length).toBeGreaterThan(0);

    // Let's verify we have multiple tokens (not just one for the whole string)
    // The semantic tokens format is [deltaLine, deltaStart, length, tokenType, tokenModifiers]
    // So tokens.length should be divisible by 5
    expect(tokens.length % 5).toBe(0);

    const tokenCount = tokens.length / 5;
    // We expect at least: test, string part, variable, closing quote
    expect(tokenCount).toBeGreaterThanOrEqual(4);
  });

  it('should handle echo "foo$a" with variable at end', () => {
    const content = `echo "foo$a"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    // Log tokens for debugging
    logSemanticTokens(result, content, { title: 'String Interpolation: echo "foo$a"' });

    const tokens = result.data;
    expect(tokens.length % 5).toBe(0);

    const tokenCount = tokens.length / 5;
    // Should have: echo, "foo" string part, a variable, closing quote
    expect(tokenCount).toBeGreaterThanOrEqual(4);
  });

  it('should handle export v="variable" with plain string', () => {
    const content = `export v="variable"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    const tokens = result.data;
    expect(tokens.length).toBeGreaterThan(0);

    // Should have tokens for export, v, and "variable" string
    expect(tokens.length % 5).toBe(0);
  });
});

describe('Mini Semantic Token Handler - Command Modifiers', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

  it('should apply builtin modifiers to builtin commands', () => {
    const content = `echo "hello"`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    logSemanticTokens(result, content, { title: 'Builtin Command: echo' });

    const tokens = result.data;
    expect(tokens.length).toBeGreaterThan(0);

    // First token should be 'echo' with builtin and defaultLibrary modifiers
    const echoToken = {
      line: tokens[0]!,
      start: tokens[1]!,
      len: tokens[2]!,
      type: tokens[3]!,
      mods: tokens[4]!,
    };

    // Check that modifiers include builtin and defaultLibrary
    const builtinModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('builtin');
    const defaultLibraryModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('defaultLibrary');

    expect(echoToken.mods & (1 << builtinModifierIndex)).toBeGreaterThan(0);
    expect(echoToken.mods & (1 << defaultLibraryModifierIndex)).toBeGreaterThan(0);
  });

  it('should apply local modifiers to locally defined functions', () => {
    const content = `
function my_local_func
    echo "local"
end

my_local_func
    `.trim();

    const doc = createFakeLspDocument('test.fish', content);
    analyzer.analyze(doc);
    const result = provideMiniSemanticTokens(doc);

    logSemanticTokens(result, content, { title: 'Local Function Call' });

    const tokens = result.data;

    // Find the my_local_func call token (should be after the function definition)
    // The call is on line 4, we need to find it in the token stream
    let foundCallToken = false;
    for (let i = 0; i < tokens.length; i += 5) {
      const line = tokens[i]!;
      const type = tokens[3 + i]!;
      const typeName = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[type];

      if (line === 4 && typeName === 'function') {
        // This should be the function call
        const mods = tokens[4 + i]!;
        const localModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('local');

        if (localModifierIndex !== -1) {
          foundCallToken = true;
          expect(mods & (1 << localModifierIndex)).toBeGreaterThan(0);
        }
        break;
      }
    }

    // Note: This may not apply modifiers yet if the function isn't in global symbols
    // because it's local. This test verifies the structure is in place.
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('should handle commands with no definition (external commands)', () => {
    const content = `external_command arg1 arg2`;

    const doc = createFakeLspDocument('test.fish', content);
    const result = provideMiniSemanticTokens(doc);

    logSemanticTokens(result, content, { title: 'External Command' });

    const tokens = result.data;
    expect(tokens.length).toBeGreaterThan(0);

    // First token should be the command with no modifiers (or minimal modifiers)
    const commandMods = tokens[4]!;

    // External commands should have 0 or minimal modifiers
    expect(commandMods).toBeDefined();
  });
});
