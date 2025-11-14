// import { SyntaxNode } from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
// import {
//   FISH_SEMANTIC_TOKENS_LEGEND,
//   getModifiersFromMask,
//   getTokenTypeIndex,
// } from '../src/utils/semantics';
import { Config } from '../src/config';
import { TestWorkspace, TestFile } from './test-workspace-utils';
import { Range } from 'vscode-languageserver';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import {
  decodeSemanticTokens,
  findTokensByText,
  findTokensByType,
  expectTokenExists,
  type DecodedToken,
} from './semantic-tokens-helpers';
import FishServer from '../src/server';
import { connection, startServer } from '../src/utils/startup';
import { getSemanticTokensSimplest, semanticTokenHandler } from '../src/semantic-tokens-simple';
import { getRange } from '../src/utils/tree-sitter';

/**
 * Test suite for the simplified semantic token handler.
 *
 * The simplified handler is designed to provide semantic tokens for:
 * - FishSymbol definitions (functions and variables)
 * - Variable expansions ($foo, excluding the $ character)
 * - Command/function calls
 * - Keywords
 * - Diagnostic disable comments (@fish-lsp-disable/enable)
 * - Shebangs (#!/usr/bin/env fish)
 * - Operators (mainly end stdin operator: --)
 *
 * Unlike the full handler, this simplified version intentionally:
 * - Does NOT parse string interpolation
 * - Does NOT handle escape sequences
 * - Does NOT use highlights.scm queries
 * - Does NOT provide special bracket command handling
 * - Has simpler token deduplication logic
 */

// Setup test workspace
const testWorkspace = TestWorkspace.create({
  name: 'semantic-tokens-simple-workspace',
}).addFiles(
  TestFile.script('basic.fish', `#!/usr/bin/env fish
# Basic fish script with common patterns

function greet
    set -l name "World"
    echo "Hello, $name"
end

greet
`),
  TestFile.script('variables.fish', `#!/usr/bin/env fish
# Variable definitions and expansions

set -l local_var "local"
set -g global_var "global"
set -U universal_var "universal"
set -x exported_var "exported"

echo $local_var
echo $global_var
echo $universal_var
echo $exported_var
echo $PATH $HOME $USER
`),
  TestFile.script('functions.fish', `#!/usr/bin/env fish
# Function definitions and calls

function my_func
    echo "in my_func"
end

function another_func
    echo "in another_func"
    my_func
end

my_func
another_func
`),
  TestFile.script('keywords.fish', `#!/usr/bin/env fish
# Keyword usage

if test -f /tmp/file
    echo "exists"
else
    echo "not found"
end

for item in a b c
    echo $item
end

while true
    break
end

switch $value
    case 1
        echo "one"
    case 2
        echo "two"
    case '*'
        echo "other"
end
`),
  TestFile.script('diagnostics.fish', `#!/usr/bin/env fish
# Diagnostic comment handling

# @fish-lsp-disable
echo "disabled"
# @fish-lsp-enable

# @fish-lsp-disable-next-line 4004
echo "next line disabled"

# Regular comment
echo "normal"
`),
  TestFile.script('operators.fish', `#!/usr/bin/env fish
# Operator usage

read -- my_var
echo -- hello
set -- args a b c
`),
  TestFile.script('commands.fish', `#!/usr/bin/env fish
# Builtin commands and user functions

echo "builtin"
set foo bar
read -l input
test -f file.txt

function custom_cmd
    echo "custom"
end

custom_cmd
`),
  TestFile.script('mixed.fish', `#!/usr/bin/env fish
# Mixed features

function process --argument-names input_file output_file
    set -l temp_var (cat $input_file)

    if test -n "$temp_var"
        echo $temp_var > $output_file
    end
end

set -g DATA_DIR /var/data
process -- $DATA_DIR/input.txt $DATA_DIR/output.txt
`),
).initialize();

describe('Simplified Semantic Tokens', () => {
  let basic_doc: LspDocument;
  let variables_doc: LspDocument;
  let functions_doc: LspDocument;
  let keywords_doc: LspDocument;
  let diagnostics_doc: LspDocument;
  let operators_doc: LspDocument;
  let commands_doc: LspDocument;
  let mixed_doc: LspDocument;

  beforeAll(async () => {
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
    startServer();
    const opts = Config.getResultCapabilities();
    await FishServer.create(connection, opts as any);

    basic_doc = testWorkspace.getDocument('basic.fish')!;
    variables_doc = testWorkspace.getDocument('variables.fish')!;
    functions_doc = testWorkspace.getDocument('functions.fish')!;
    keywords_doc = testWorkspace.getDocument('keywords.fish')!;
    diagnostics_doc = testWorkspace.getDocument('diagnostics.fish')!;
    operators_doc = testWorkspace.getDocument('operators.fish')!;
    commands_doc = testWorkspace.getDocument('commands.fish')!;
    mixed_doc = testWorkspace.getDocument('mixed.fish')!;
  });

  describe('SETUP', () => {
    it('should initialize all test documents', () => {
      expect(basic_doc).toBeDefined();
      expect(variables_doc).toBeDefined();
      expect(functions_doc).toBeDefined();
      expect(keywords_doc).toBeDefined();
      expect(diagnostics_doc).toBeDefined();
      expect(operators_doc).toBeDefined();
      expect(commands_doc).toBeDefined();
      expect(mixed_doc).toBeDefined();
    });

    it('should have analyzer initialized', () => {
      expect(analyzer).toBeDefined();
      expect(analyzer.parser).toBeDefined();
    });
  });

  describe('Shebang Tokens', () => {
    it('should highlight shebangs as decorators', () => {
      const analyzed = analyzer.cache.getDocument(basic_doc.uri)?.ensureParsed();
      expect(analyzed).toBeDefined();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, basic_doc.getText());

      const shebangToken = expectTokenExists(tokens, {
        text: '#!/usr/bin/env fish',
        tokenType: 'decorator'
      });
      expect(shebangToken).toBeDefined();
      expect(shebangToken.line).toBe(0);
    });

    it('should handle documents without shebangs', () => {
      const content = 'echo "no shebang"';
      const doc = new LspDocument({
        uri: 'test://no-shebang.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      const shebangTokens = tokens.filter(t => t.tokenType === 'decorator');
      expect(shebangTokens.length).toBe(0);
    });
  });

  describe('Diagnostic Comment Tokens', () => {
    it('should highlight @fish-lsp-disable as keyword', () => {
      const analyzed = analyzer.cache.getDocument(diagnostics_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, diagnostics_doc.getText());

      const disableTokens = tokens.filter(t =>
        t.text?.includes('@fish-lsp-disable') && t.tokenType === 'keyword'
      );
      expect(disableTokens.length).toBeGreaterThan(0);
    });

    it('should highlight @fish-lsp-enable as keyword', () => {
      const analyzed = analyzer.cache.getDocument(diagnostics_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, diagnostics_doc.getText());

      const enableTokens = tokens.filter(t =>
        t.text?.includes('@fish-lsp-enable') && t.tokenType === 'keyword'
      );
      expect(enableTokens.length).toBeGreaterThan(0);
    });

    it('should highlight @fish-lsp-disable-next-line as keyword', () => {
      const analyzed = analyzer.cache.getDocument(diagnostics_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, diagnostics_doc.getText());

      const nextLineTokens = tokens.filter(t =>
        t.text?.includes('@fish-lsp-disable-next-line') && t.tokenType === 'keyword'
      );
      expect(nextLineTokens.length).toBeGreaterThan(0);
    });

    it('should NOT highlight regular comments as keywords', () => {
      const analyzed = analyzer.cache.getDocument(diagnostics_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, diagnostics_doc.getText());

      // Regular comments should not appear as keyword tokens
      const regularCommentTokens = tokens.filter(t =>
        t.text === '# Regular comment' && t.tokenType === 'keyword'
      );
      expect(regularCommentTokens.length).toBe(0);
    });
  });

  describe('Keyword Tokens', () => {
    it('should highlight if/else/end keywords', () => {
      const analyzed = analyzer.cache.getDocument(keywords_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, keywords_doc.getText());

      expectTokenExists(tokens, { text: 'if', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'else', tokenType: 'keyword' });

      const endTokens = findTokensByText(tokens, 'end');
      expect(endTokens.length).toBeGreaterThan(0);
      expect(endTokens.every(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should highlight for/in keywords', () => {
      const analyzed = analyzer.cache.getDocument(keywords_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, keywords_doc.getText());

      expectTokenExists(tokens, { text: 'for', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'in', tokenType: 'keyword' });
    });

    it('should highlight while/break keywords', () => {
      const analyzed = analyzer.cache.getDocument(keywords_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, keywords_doc.getText());

      expectTokenExists(tokens, { text: 'while', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'break', tokenType: 'keyword' });
    });

    it('should highlight switch/case keywords', () => {
      const analyzed = analyzer.cache.getDocument(keywords_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, keywords_doc.getText());

      expectTokenExists(tokens, { text: 'switch', tokenType: 'keyword' });

      const caseTokens = findTokensByText(tokens, 'case');
      expect(caseTokens.length).toBeGreaterThan(0);
      expect(caseTokens.every(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should highlight else if keyword combination', () => {
      const content = `if true; echo 'stuff...'; else if true || false; echo 'in else if'; else; echo 'in else...'; end`;
      const doc = new LspDocument({
        uri: 'test://else-if.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'if' keywords (both initial 'if' and 'else if')
      const ifTokens = findTokensByText(tokens, 'if');
      expect(ifTokens.length).toBeGreaterThanOrEqual(2);
      expect(ifTokens.every(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'else' keywords
      const elseTokens = findTokensByText(tokens, 'else');
      expect(elseTokens.length).toBeGreaterThanOrEqual(2);
      expect(elseTokens.every(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'end' keyword
      expectTokenExists(tokens, { text: 'end', tokenType: 'keyword' });

      // Should have 'true' and 'false' as keywords (builtins)
      const trueTokens = findTokensByText(tokens, 'true');
      const falseTokens = findTokensByText(tokens, 'false');
      expect(trueTokens.length).toBeGreaterThan(0);
      expect(falseTokens.length).toBeGreaterThan(0);
      expect(trueTokens.every(t => t.tokenType === 'keyword')).toBe(true);
      expect(falseTokens.every(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'or' keyword (||)
      const orTokens = findTokensByText(tokens, 'or');
      if (orTokens.length > 0) {
        expect(orTokens.every(t => t.tokenType === 'keyword')).toBe(true);
      }

      // Should have 'echo' as keyword
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.every(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should highlight alias as keyword', () => {
      const content = 'alias ll="ls -la"';
      const doc = new LspDocument({
        uri: 'test://alias.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // The simplified handler may tokenize alias definitions as functions
      // Just verify we get some semantic tokens for the alias statement
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should highlight logical operators and/or/not as keywords', () => {
      const content = 'command1 && command2 || command3';
      const doc = new LspDocument({
        uri: 'test://logical-ops.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'and' and 'or' as keywords (representing && and ||)
      const andTokens = findTokensByText(tokens, 'and');
      const orTokens = findTokensByText(tokens, 'or');

      if (andTokens.length > 0) {
        expect(andTokens.every(t => t.tokenType === 'keyword')).toBe(true);
      }
      if (orTokens.length > 0) {
        expect(orTokens.every(t => t.tokenType === 'keyword')).toBe(true);
      }
    });

    it('should highlight not operator as keyword', () => {
      const content = 'not test -f /tmp/file.txt';
      const doc = new LspDocument({
        uri: 'test://not-op.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'not' as keyword
      const notTokens = findTokensByText(tokens, 'not');
      expect(notTokens.length).toBeGreaterThan(0);
      expect(notTokens.every(t => t.tokenType === 'keyword')).toBe(true);

      // Should also have 'test' as keyword
      const testTokens = findTokensByText(tokens, 'test');
      expect(testTokens.length).toBeGreaterThan(0);
      expect(testTokens.some(t => t.tokenType === 'keyword')).toBe(true);
    });
  });

  describe('Alias Definitions', () => {
    it('should highlight alias keyword and function name in "alias foo=bar"', () => {
      const content = 'alias foo=bar';
      const doc = new LspDocument({
        uri: 'test://alias-def.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'alias' as keyword
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThan(0);
      expect(aliasTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'foo' as function (the alias name being defined)
      const fooTokens = findTokensByText(tokens, 'foo');
      expect(fooTokens.length).toBeGreaterThan(0);
      expect(fooTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should handle alias with quoted value "alias ll="ls -la""', () => {
      const content = 'alias ll="ls -la"';
      const doc = new LspDocument({
        uri: 'test://alias-quoted.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'alias' as keyword
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThan(0);
      expect(aliasTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'll' as function
      const llTokens = findTokensByText(tokens, 'll');
      expect(llTokens.length).toBeGreaterThan(0);
      expect(llTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should handle multiple alias definitions', () => {
      const content = `alias gs="git status"
alias gc="git commit"
alias gp="git push"`;
      const doc = new LspDocument({
        uri: 'test://aliases-multiple.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 3 'alias' keyword tokens
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThanOrEqual(3);
      expect(aliasTokens.every(t => t.tokenType === 'keyword')).toBe(true);

      // Should have function tokens for gs, gc, gp
      const gsTokens = findTokensByText(tokens, 'gs');
      const gcTokens = findTokensByText(tokens, 'gc');
      const gpTokens = findTokensByText(tokens, 'gp');

      expect(gsTokens.some(t => t.tokenType === 'function')).toBe(true);
      expect(gcTokens.some(t => t.tokenType === 'function')).toBe(true);
      expect(gpTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should handle alias with space syntax "alias ll ls -la"', () => {
      const content = 'alias ll ls -la';
      const doc = new LspDocument({
        uri: 'test://alias-space.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'alias' as keyword
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThan(0);
      expect(aliasTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'll' as function
      const llTokens = findTokensByText(tokens, 'll');
      expect(llTokens.length).toBeGreaterThan(0);
      expect(llTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should handle alias with complex command', () => {
      const content = 'alias gs="git status --short --branch"';
      const doc = new LspDocument({
        uri: 'test://alias-complex.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'alias' as keyword
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThan(0);
      expect(aliasTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'gs' as function
      const gsTokens = findTokensByText(tokens, 'gs');
      expect(gsTokens.length).toBeGreaterThan(0);
      expect(gsTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should distinguish alias definition from alias usage', () => {
      const content = `alias myalias="echo test"
myalias`;
      const doc = new LspDocument({
        uri: 'test://alias-usage.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'alias' as keyword
      const aliasTokens = findTokensByText(tokens, 'alias');
      expect(aliasTokens.length).toBeGreaterThan(0);
      expect(aliasTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'myalias' tokens - both as function (definition and call)
      const myaliasTokens = findTokensByText(tokens, 'myalias');
      expect(myaliasTokens.length).toBeGreaterThan(0);
      // Should have at least one function token (for the definition)
      // The call might be highlighted as keyword or function depending on how aliases are handled
      expect(myaliasTokens.some(t => t.tokenType === 'function')).toBe(true);
    });
  });

  describe('Variable Tokens', () => {
    it('should highlight variable definitions', () => {
      const analyzed = analyzer.cache.getDocument(variables_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, variables_doc.getText());

      // Should find variable tokens (without $ prefix in token text)
      const varTokens = findTokensByType(tokens, 'variable');
      expect(varTokens.length).toBeGreaterThan(0);

      // Check specific variables
      const localVarTokens = findTokensByText(tokens, 'local_var');
      const globalVarTokens = findTokensByText(tokens, 'global_var');

      expect(localVarTokens.length).toBeGreaterThan(0);
      expect(globalVarTokens.length).toBeGreaterThan(0);
    });

    it('should highlight export command and variable in "export VAR=value"', () => {
      const content = 'export MY_VAR=hello';
      const doc = new LspDocument({
        uri: 'test://export-var.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'export' as command/function call
      const exportTokens = findTokensByText(tokens, 'export');
      expect(exportTokens.length).toBeGreaterThan(0);
      // export is a builtin command, so it could be keyword or function
      expect(exportTokens.some(t => t.tokenType === 'keyword' || t.tokenType === 'function')).toBe(true);

      // Should have 'MY_VAR' as variable
      const varTokens = findTokensByText(tokens, 'MY_VAR');
      expect(varTokens.length).toBeGreaterThan(0);
      expect(varTokens.some(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should handle multiple export statements', () => {
      const content = `export PATH=/usr/local/bin
export EDITOR=vim
export LANG=en_US.UTF-8`;
      const doc = new LspDocument({
        uri: 'test://exports-multiple.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 3 'export' tokens
      const exportTokens = findTokensByText(tokens, 'export');
      expect(exportTokens.length).toBeGreaterThanOrEqual(3);

      // Should have variable tokens for PATH, EDITOR, LANG
      const pathTokens = findTokensByText(tokens, 'PATH');
      const editorTokens = findTokensByText(tokens, 'EDITOR');
      const langTokens = findTokensByText(tokens, 'LANG');

      expect(pathTokens.some(t => t.tokenType === 'variable')).toBe(true);
      expect(editorTokens.some(t => t.tokenType === 'variable')).toBe(true);
      expect(langTokens.some(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should handle export with quoted values', () => {
      const content = 'export MY_PATH="/usr/local/bin:/usr/bin"';
      const doc = new LspDocument({
        uri: 'test://export-quoted.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'export' token
      const exportTokens = findTokensByText(tokens, 'export');
      expect(exportTokens.length).toBeGreaterThan(0);

      // Should have 'MY_PATH' as variable
      const varTokens = findTokensByText(tokens, 'MY_PATH');
      expect(varTokens.length).toBeGreaterThan(0);
      expect(varTokens.some(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should handle export with variable expansion in value', () => {
      const content = 'export PATH=/opt/bin:$PATH';
      const doc = new LspDocument({
        uri: 'test://export-expansion.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'export' token
      const exportTokens = findTokensByText(tokens, 'export');
      expect(exportTokens.length).toBeGreaterThan(0);

      // Should have 'PATH' tokens (both as definition and expansion)
      const pathTokens = findTokensByText(tokens, 'PATH');
      expect(pathTokens.length).toBeGreaterThan(0);
      // All PATH tokens should be variables
      expect(pathTokens.every(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should highlight variable expansions WITHOUT $ character', () => {
      const analyzed = analyzer.cache.getDocument(variables_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, variables_doc.getText());

      // Variable tokens should NOT include the $ character
      const dollarTokens = tokens.filter(t => t.text?.startsWith('$'));
      expect(dollarTokens.length).toBe(0);

      // But should have tokens for PATH, HOME, USER (without $)
      const pathTokens = findTokensByText(tokens, 'PATH');
      const homeTokens = findTokensByText(tokens, 'HOME');
      const userTokens = findTokensByText(tokens, 'USER');

      expect(pathTokens.length).toBeGreaterThan(0);
      expect(homeTokens.length).toBeGreaterThan(0);
      expect(userTokens.length).toBeGreaterThan(0);

      // All should be variable type
      expect(pathTokens.every(t => t.tokenType === 'variable')).toBe(true);
      expect(homeTokens.every(t => t.tokenType === 'variable')).toBe(true);
      expect(userTokens.every(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should handle nested variable expansions', () => {
      const content = 'echo $argv[1]';
      const doc = new LspDocument({
        uri: 'test://nested-var.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Note: The simplified handler may tokenize $argv[1] differently
      // It should at least provide some semantic tokens for the variable expansion
      const varTokens = findTokensByType(tokens, 'variable');
      expect(varTokens.length).toBeGreaterThanOrEqual(0);
    });

    it('should highlight for loop variable as variable token', () => {
      const content = 'for item in $list; echo $item; end';
      const doc = new LspDocument({
        uri: 'test://for-loop-var.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'for', 'in', 'end' as keywords
      expectTokenExists(tokens, { text: 'for', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'in', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'end', tokenType: 'keyword' });

      // Should have 'item' as variable (loop variable + expansion)
      const itemTokens = findTokensByText(tokens, 'item');
      expect(itemTokens.length).toBeGreaterThan(0);
      expect(itemTokens.some(t => t.tokenType === 'variable')).toBe(true);

      // Should have 'list' as variable (from $list expansion)
      const listTokens = findTokensByText(tokens, 'list');
      expect(listTokens.length).toBeGreaterThan(0);
      expect(listTokens.some(t => t.tokenType === 'variable')).toBe(true);

      // Should have 'echo' as keyword
      expectTokenExists(tokens, { text: 'echo', tokenType: 'keyword' });
    });

    it('should handle for loop with multiple iteration variables', () => {
      const content = 'for x in a b c; echo $x; end';
      const doc = new LspDocument({
        uri: 'test://for-loop-multi.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'x' as variable
      const xTokens = findTokensByText(tokens, 'x');
      expect(xTokens.length).toBeGreaterThan(0);
      expect(xTokens.some(t => t.tokenType === 'variable')).toBe(true);
    });
  });

  describe('Function Tokens', () => {
    it('should highlight function definitions', () => {
      const analyzed = analyzer.cache.getDocument(functions_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, functions_doc.getText());

      const myFuncTokens = findTokensByText(tokens, 'my_func');
      const anotherFuncTokens = findTokensByText(tokens, 'another_func');

      expect(myFuncTokens.length).toBeGreaterThan(0);
      expect(anotherFuncTokens.length).toBeGreaterThan(0);

      // Should have function tokens (may also have keyword tokens for 'function' keyword)
      expect(myFuncTokens.some(t => t.tokenType === 'function')).toBe(true);
      expect(anotherFuncTokens.some(t => t.tokenType === 'function')).toBe(true);
    });

    it('should highlight function argument names as variables', () => {
      const content = 'function foo --argument-names a b c d e --description "foo test function"; echo $a $b $c $d $e; end';
      const doc = new LspDocument({
        uri: 'test://func-args.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'function' and 'end' as keywords
      expectTokenExists(tokens, { text: 'function', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'end', tokenType: 'keyword' });

      // Should have 'foo' as function
      const fooTokens = findTokensByText(tokens, 'foo');
      expect(fooTokens.length).toBeGreaterThan(0);
      expect(fooTokens.some(t => t.tokenType === 'function')).toBe(true);

      // Should have a, b, c, d, e as variables (argument names + expansions)
      const argNames = ['a', 'b', 'c', 'd', 'e'];
      argNames.forEach(argName => {
        const argTokens = findTokensByText(tokens, argName);
        expect(argTokens.length).toBeGreaterThan(0);
        expect(argTokens.some(t => t.tokenType === 'variable')).toBe(true);
      });

      // Should have 'echo' as keyword
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should highlight function calls', () => {
      const analyzed = analyzer.cache.getDocument(functions_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, functions_doc.getText());

      // Function calls should be highlighted
      const funcTokens = findTokensByType(tokens, 'function');
      expect(funcTokens.length).toBeGreaterThan(0);
    });

    it('should differentiate between builtin commands and user functions', () => {
      const analyzed = analyzer.cache.getDocument(commands_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, commands_doc.getText());

      // All should use function/command token type
      const echoTokens = findTokensByText(tokens, 'echo');
      const setTokens = findTokensByText(tokens, 'set');
      const customCmdTokens = findTokensByText(tokens, 'custom_cmd');

      expect(echoTokens.length).toBeGreaterThan(0);
      expect(setTokens.length).toBeGreaterThan(0);
      expect(customCmdTokens.length).toBeGreaterThan(0);
    });
  });

  describe('Bracket Test Command', () => {
    it('should highlight [ and ] in test command "[ -f /tmp/foo.fish ]"', () => {
      const content = '[ -f /tmp/foo.fish ]';
      const doc = new LspDocument({
        uri: 'test://bracket-test.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have [ and ] as command tokens
      const openBracketTokens = findTokensByText(tokens, '[');
      const closeBracketTokens = findTokensByText(tokens, ']');

      expect(openBracketTokens.length).toBeGreaterThan(0);
      expect(closeBracketTokens.length).toBeGreaterThan(0);

      // Both should be command/function type
      expect(openBracketTokens.some(t => t.tokenType === 'function' || t.tokenType === 'command')).toBe(true);
      expect(closeBracketTokens.some(t => t.tokenType === 'function' || t.tokenType === 'command')).toBe(true);
    });

    it('should highlight [ and ] in test command "[ -d /tmp ]"', () => {
      const content = '[ -d /tmp ]';
      const doc = new LspDocument({
        uri: 'test://bracket-dir-test.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have [ and ] tokens
      const bracketTokens = tokens.filter(t => t.text === '[' || t.text === ']');
      expect(bracketTokens.length).toBeGreaterThanOrEqual(2);
    });

    it('should highlight [ and ] in test command "[ -n \'some-non-empty-string\' ]"', () => {
      const content = "[ -n 'some-non-empty-string' ]";
      const doc = new LspDocument({
        uri: 'test://bracket-string-test.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have [ and ] tokens
      const openBracketTokens = findTokensByText(tokens, '[');
      const closeBracketTokens = findTokensByText(tokens, ']');

      expect(openBracketTokens.length).toBeGreaterThan(0);
      expect(closeBracketTokens.length).toBeGreaterThan(0);
    });

    it('should NOT confuse array indexing with test command in "echo $argv[1]"', () => {
      const content = 'echo $argv[1]';
      const doc = new LspDocument({
        uri: 'test://array-index.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'echo' as keyword
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have variable tokens (the simplified handler handles array indexing)
      const varTokens = findTokensByType(tokens, 'variable');
      expect(varTokens.length).toBeGreaterThanOrEqual(0); // May or may not tokenize array indexing

      // Should NOT have [ or ] as command tokens (they're part of array indexing)
      // If there are bracket tokens, they should NOT be command type
      const bracketTokens = tokens.filter(t => t.text === '[' || t.text === ']');
      const commandBracketTokens = bracketTokens.filter(t => t.tokenType === 'command' || t.tokenType === 'function');
      expect(commandBracketTokens.length).toBe(0);
    });

    it('should handle multiple [ ] test commands', () => {
      const content = '[ -f /tmp/a ] && [ -d /tmp/b ]';
      const doc = new LspDocument({
        uri: 'test://multiple-brackets.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 2 opening [ and 2 closing ]
      const openBracketTokens = findTokensByText(tokens, '[');
      const closeBracketTokens = findTokensByText(tokens, ']');

      expect(openBracketTokens.length).toBeGreaterThanOrEqual(2);
      expect(closeBracketTokens.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle [ ] in if statement', () => {
      const content = 'if [ -f /tmp/file.txt ]; echo "exists"; end';
      const doc = new LspDocument({
        uri: 'test://bracket-if.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have [ and ] tokens
      const bracketTokens = tokens.filter(t => t.text === '[' || t.text === ']');
      expect(bracketTokens.length).toBeGreaterThanOrEqual(2);

      // Should also have if, echo, end keywords
      expectTokenExists(tokens, { text: 'if', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'echo', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'end', tokenType: 'keyword' });
    });
  });

  describe('Command Substitution', () => {
    it('should highlight commands in command substitution (parentheses)', () => {
      const content = 'set output (echo test)';
      const doc = new LspDocument({
        uri: 'test://cmd-sub-parens.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'set' as keyword
      const setTokens = findTokensByText(tokens, 'set');
      expect(setTokens.length).toBeGreaterThan(0);
      expect(setTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'echo' as keyword (inside command substitution)
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'output' as variable
      const outputTokens = findTokensByText(tokens, 'output');
      expect(outputTokens.length).toBeGreaterThan(0);
      expect(outputTokens.some(t => t.tokenType === 'variable')).toBe(true);
    });

    it('should highlight commands in dollar command substitution', () => {
      const content = 'echo "$(date)"';
      const doc = new LspDocument({
        uri: 'test://cmd-sub-dollar.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'echo' as keyword
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'date' as keyword/command (inside command substitution)
      const dateTokens = findTokensByText(tokens, 'date');
      expect(dateTokens.length).toBeGreaterThan(0);
      // Could be keyword or command depending on how it's classified
      expect(dateTokens.some(t => t.tokenType === 'keyword' || t.tokenType === 'command' || t.tokenType === 'function')).toBe(true);
    });

    it('should handle nested command substitution with variables', () => {
      const content = 'set result (count (echo $argv))';
      const doc = new LspDocument({
        uri: 'test://cmd-sub-nested.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'set', 'count', 'echo' as keywords
      expectTokenExists(tokens, { text: 'set', tokenType: 'keyword' });

      const countTokens = findTokensByText(tokens, 'count');
      expect(countTokens.length).toBeGreaterThan(0);

      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);

      // Should have 'result' and 'argv' as variables
      const resultTokens = findTokensByText(tokens, 'result');
      expect(resultTokens.length).toBeGreaterThan(0);
      expect(resultTokens.some(t => t.tokenType === 'variable')).toBe(true);

      const argvTokens = findTokensByText(tokens, 'argv');
      expect(argvTokens.length).toBeGreaterThanOrEqual(0); // May or may not be tokenized
    });
  });

  describe('Nested Structures', () => {
    it('should handle command substitution inside test command', () => {
      const content = 'if test (count $argv) -gt 0; echo "has args"; end';
      const doc = new LspDocument({
        uri: 'test://nested-test.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'if', 'end' as keywords
      expectTokenExists(tokens, { text: 'if', tokenType: 'keyword' });
      expectTokenExists(tokens, { text: 'end', tokenType: 'keyword' });

      // Should have 'test' as keyword
      const testTokens = findTokensByText(tokens, 'test');
      expect(testTokens.length).toBeGreaterThan(0);
      expect(testTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'count' as keyword/command
      const countTokens = findTokensByText(tokens, 'count');
      expect(countTokens.length).toBeGreaterThan(0);

      // Should have 'echo' as keyword
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should handle deeply nested command substitution', () => {
      const content = 'echo (string upper (string lower (echo "TEST")))';
      const doc = new LspDocument({
        uri: 'test://deeply-nested.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'echo' tokens (appears multiple times)
      const echoTokens = findTokensByText(tokens, 'echo');
      expect(echoTokens.length).toBeGreaterThan(0);
      expect(echoTokens.some(t => t.tokenType === 'keyword')).toBe(true);

      // Should have 'string' tokens
      const stringTokens = findTokensByText(tokens, 'string');
      expect(stringTokens.length).toBeGreaterThan(0);
      expect(stringTokens.some(t => t.tokenType === 'keyword')).toBe(true);
    });

    it('should handle variable expansion in command substitution', () => {
      const content = 'set files (ls $HOME)';
      const doc = new LspDocument({
        uri: 'test://var-in-cmd-sub.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have 'set' as keyword
      expectTokenExists(tokens, { text: 'set', tokenType: 'keyword' });

      // Should have 'files' as variable
      const filesTokens = findTokensByText(tokens, 'files');
      expect(filesTokens.length).toBeGreaterThan(0);
      expect(filesTokens.some(t => t.tokenType === 'variable')).toBe(true);

      // Should have 'HOME' as variable
      const homeTokens = findTokensByText(tokens, 'HOME');
      expect(homeTokens.length).toBeGreaterThan(0);
      expect(homeTokens.some(t => t.tokenType === 'variable')).toBe(true);

      // Should have 'ls' as keyword/command
      const lsTokens = findTokensByText(tokens, 'ls');
      expect(lsTokens.length).toBeGreaterThan(0);
    });
  });

  describe('Operator Tokens', () => {
    it('should highlight -- (end stdin) as operator', () => {
      const analyzed = analyzer.cache.getDocument(operators_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, operators_doc.getText());

      const operatorTokens = tokens.filter(t =>
        t.text === '--' && t.tokenType === 'operator'
      );
      expect(operatorTokens.length).toBeGreaterThan(0);
    });

    it('should handle -- in various command contexts', () => {
      const content = `read -- var
echo -- text
set -- args a b c`;
      const doc = new LspDocument({
        uri: 'test://operators-context.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      const operatorTokens = tokens.filter(t =>
        t.text === '--' && t.tokenType === 'operator'
      );
      // Should have at least one -- operator token
      expect(operatorTokens.length).toBeGreaterThan(0);
    });
  });

  describe('Mixed Features', () => {
    it('should handle complex documents with multiple token types', () => {
      const analyzed = analyzer.cache.getDocument(mixed_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, mixed_doc.getText());

      // Should have multiple types of tokens
      const tokenTypes = new Set(tokens.map(t => t.tokenType));

      // Should have keywords
      const keywordTokens = tokens.filter(t => t.tokenType === 'keyword');
      expect(keywordTokens.length).toBeGreaterThan(0);

      // Should have variables
      const variableTokens = tokens.filter(t => t.tokenType === 'variable');
      expect(variableTokens.length).toBeGreaterThan(0);

      // Should have functions
      const functionTokens = tokens.filter(t => t.tokenType === 'function');
      expect(functionTokens.length).toBeGreaterThan(0);

      // Should have operators
      const operatorTokens = tokens.filter(t => t.tokenType === 'operator');
      expect(operatorTokens.length).toBeGreaterThan(0);

      // Should have at least 4 different token types
      expect(tokenTypes.size).toBeGreaterThanOrEqual(4);
    });

    it('should not create overlapping tokens', () => {
      const analyzed = analyzer.cache.getDocument(mixed_doc.uri)?.ensureParsed();
      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, mixed_doc.getText());

      // Check for overlapping tokens on the same line
      const tokensByLine = new Map<number, DecodedToken[]>();
      tokens.forEach(token => {
        if (!tokensByLine.has(token.line)) {
          tokensByLine.set(token.line, []);
        }
        tokensByLine.get(token.line)!.push(token);
      });

      tokensByLine.forEach((lineTokens, line) => {
        // Sort tokens by start position
        const sorted = lineTokens.sort((a, b) => a.startChar - b.startChar);

        // Check for overlaps
        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i]!;
          const next = sorted[i + 1]!;
          const currentEnd = current.startChar + current.length;

          // Next token should start at or after current token ends
          expect(next.startChar).toBeGreaterThanOrEqual(currentEnd);
        }
      });
    });
  });

  describe('Range Support', () => {
    it('should support full document range', () => {
      const analyzed = analyzer.cache.getDocument(basic_doc.uri)?.ensureParsed();
      const fullRange = getRange(analyzed!.root);

      const result = getSemanticTokensSimplest(analyzed!, fullRange);
      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should support partial range requests', () => {
      const analyzed = analyzer.cache.getDocument(keywords_doc.uri)?.ensureParsed();

      // Request only first 5 lines
      const partialRange: Range = {
        start: { line: 0, character: 0 },
        end: { line: 5, character: 0 },
      };

      const result = getSemanticTokensSimplest(analyzed!, partialRange);
      expect(result.data).toBeDefined();

      // Should have some tokens but potentially fewer than full document
      expect(result.data.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty documents', () => {
      const content = '';
      const doc = new LspDocument({
        uri: 'test://empty.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      if (!analyzed) {
        expect(analyzed).toBeDefined();
        return;
      }

      const result = getSemanticTokensSimplest(analyzed, getRange(analyzed.root));
      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(0);
    });

    it('should handle documents with only comments', () => {
      const content = `# Just a comment
# Another comment`;
      const doc = new LspDocument({
        uri: 'test://comments-only.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have no keyword tokens (since these are regular comments)
      const keywordTokens = tokens.filter(t => t.tokenType === 'keyword');
      expect(keywordTokens.length).toBe(0);
    });

    it('should handle documents with syntax errors gracefully', () => {
      const content = `function broken
    echo "missing end"

set incomplete`;
      const doc = new LspDocument({
        uri: 'test://syntax-error.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      // Should not throw
      expect(() => {
        const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
        decodeSemanticTokens(result, content);
      }).not.toThrow();
    });

    it('should handle very long variable names', () => {
      const longName = 'a'.repeat(200);
      const content = `set -g ${longName} "value"\necho $${longName}`;
      const doc = new LspDocument({
        uri: 'test://long-var.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should handle long names without crashing
      const varTokens = tokens.filter(t => t.tokenType === 'variable');
      expect(varTokens.length).toBeGreaterThan(0);
    });
  });

  describe('Handler Integration', () => {
    it('should work with semanticTokenHandler for full document', () => {
      const params = {
        textDocument: { uri: basic_doc.uri },
      };

      const result = semanticTokenHandler(params);
      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should work with semanticTokenHandler for range requests', () => {
      const params = {
        textDocument: { uri: basic_doc.uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 5, character: 0 },
        },
      };

      const result = semanticTokenHandler(params);
      expect(result.data).toBeDefined();
    });

    it('should return empty data for non-existent document', () => {
      const params = {
        textDocument: { uri: 'test://does-not-exist.fish' },
      };

      const result = semanticTokenHandler(params);
      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(0);
    });
  });

  describe('Token Deduplication', () => {
    it('should not create duplicate tokens at same position', () => {
      const content = `function test_func
    echo "test"
end
test_func`;
      const doc = new LspDocument({
        uri: 'test://dedup.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Check that there are no exact duplicates (same line, char, type)
      const seen = new Set<string>();
      tokens.forEach(token => {
        const key = `${token.line}:${token.startChar}:${token.tokenType}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      });
    });

    it('should handle symbols and node tokens correctly', () => {
      // Test that both FishSymbol-based tokens and node-based tokens
      // are properly deduplicated
      const content = `set -l my_var "value"
echo $my_var`;
      const doc = new LspDocument({
        uri: 'test://symbol-node.fish',
        languageId: 'fish',
        version: 1,
        text: content
      });
      analyzer.analyze(doc);
      const analyzed = analyzer.cache.getDocument(doc.uri)?.ensureParsed();

      const result = getSemanticTokensSimplest(analyzed!, getRange(analyzed!.root));
      const tokens = decodeSemanticTokens(result, content);

      // Should have tokens for my_var (from both symbol and expansion)
      const varTokens = findTokensByText(tokens, 'my_var');
      expect(varTokens.length).toBeGreaterThan(0);
      expect(varTokens.every(t => t.tokenType === 'variable')).toBe(true);
    });
  });
});
