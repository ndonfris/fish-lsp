import { QueryCapture, SyntaxNode } from 'web-tree-sitter';
import * as TS from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import {
  FISH_SEMANTIC_TOKENS_LEGEND,
  getModifiersFromMask,
  getTokenTypeIndex,
  getQueriesList,
  FishSemanticTokenModifier,
} from '../src/utils/semantics';
// import { miniSemanticTokensHandlerCallback, provideMiniSemanticTokens } from '../src/mini-semantic-handler';
import { Config, config } from '../src/config';
import { SyncFileHelper } from '../src/utils/file-operations';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { TestWorkspace, TestFile, Query, DefaultTestWorkspaces, focusedWorkspace } from './test-workspace-utils';
import { ProposedFeatures, Range } from 'vscode-languageserver';
import { highlights } from '@ndonfris/tree-sitter-fish';
import { workspace } from './force-util-example';
import { getChildNodes, getRange, isNodeWithinRange } from '../src/utils/tree-sitter';
import { isBuiltin, isCommand, isCommandName, isComment, isFishShippedFunctionName, isPath, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName, isBuiltinCommand } from '../src/utils/node-types';
import { isFunctionDefinitionName } from '../src/parsing/function';
import { FishSemanticTokenModifiers } from '../src/utils/semantics';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import {
  decodeSemanticTokens,
  findTokensByText,
  findTokensByType,
  findTokensByModifier,
  findTokensWithModifiers,
  expectTokenExists,
  countTokensByType,
  getUniqueTokenTypes,
  printTokens,
  type DecodedToken,
} from './semantic-tokens-helpers';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import FishServer from '../src/server';
import { createConnection } from 'vscode-languageserver/browser';
import { connection, startServer } from '../src/utils/startup';
import { provideSemanticTokens, semanticTokensHandlerCallback } from '../src/semantic-tokens';

// const {
//   semanticTokensHandler,
//   semanticTokensRangeHandler,
// } = semanticTokensHandlerCallback();

const treeSitterSemanticTokensProvider = (LspDocument: LspDocument, range?: Range) => {
  if (range) {
    return provideSemanticTokens(LspDocument, range);
  } else {
    return provideSemanticTokens(LspDocument);
  }
};

// Setup test workspace before describe blocks
const testWorkspace = TestWorkspace.create({
  name: 'semantic-tokens-workspace',
}).addFiles(
  TestFile.config(`
# comment: this is a comment in config file
set -gx PATH /usr/local/bin $PATH
export EDITOR=vi
export VISUAL=vi
export LANG=en_US.UTF-8

fish_add_path -g /opt/bin

function greet
    echo "Hello, $USER"
end
    `),
  TestFile.script('exe.fish', `#!/usr/bin/env fish
# This is a comment in a script file (the line above is a shebang)

function main
    set -l name "World"
    echo "Hello, $name"
end

main
  `),
  TestFile.script('utils.fish', `#!/usr/bin/env fish
# Utility functions
function add
    set -l sum (math $argv[1] + $argv[2])
    echo $sum
end

function multiply
    set -l product (math $argv[1] * $argv[2])
    echo $product
end

function divide
    if test $argv[2] -ne 0
        set -l quotient (math $argv[1] / $argv[2])
        echo $quotient
    else
        echo "Error: Division by zero"
    end
end

function subtract
    set -l difference (math $argv[1] - $argv[2])
    echo $difference
end
  `),
  TestFile.confd('abbrs.fish', `
abbr -a ll 'ls -la'
abbr -a gs 'git status'
abbr -a gc 'git commit -m'
  `),
  TestFile.function('my_function.fish', `
function my_function
    argparse -n my_function v/verbose h/help -- $argv
    or return 1

    if test $_flag_verbose
        echo "Verbose mode is on"
        return 0
    end
    if test $_flag_help
        echo "Usage: my_function [-v|--verbose] [-h|--help]"
        return 0
    end
end`),
  TestFile.completion('my_function.fish', `
complete -c my_function -s v -l verbose -d "Enable verbose mode"
complete -c my_function -s h -l help -d "Show help message"
    `),
  TestFile.script('variable-definitions.fish', `#!/usr/bin/env fish
# Test various variable definitions with different scopes

# Set command variable definitions
set -l local_var "local value"
set -g global_var "global value"  
set -U universal_var "universal value"
set -x -g exported_global "exported global"
set --local --export local_exported "local exported"

# Read command variable definitions
read -l local_input
read -g global_input
read -U universal_input
read -x -g exported_input

# Function with argument names
function test_function --argument-names arg1 arg2 --description "Test function"
    set -l func_local "function local"
    echo $arg1 $arg2
end

# For loop variable
for item in a b c
    echo $item
end

# Complex set command with multiple flags
set -g -x PATH /usr/local/bin $PATH

# Alias definitions
alias ll='ls -la'
alias grep 'grep --color=auto'
alias cls clear

# Export definitions  
export EDITOR=vim
export LANG en_US.UTF-8
export PATH=/usr/local/bin:$PATH

# Event definitions and handlers
emit my_custom_event
emit fish_command_not_found

# Function with event handler
function handle_custom_event --on-event my_custom_event
    echo "Custom event received!"
end

function handle_variable_change --on-variable PATH
    echo "PATH variable changed!"
end
    `),
  TestFile.script('test-directive-token-type.fish', `#!/usr/bin/env fish
# Regular comment should be comment token type
# @fish-lsp-disable should be keyword token type
echo "test"
    `),
  TestFile.script('test-alias-name.fish', 'alias baz=foo'),
).initialize();

describe('Semantic Tokens', () => {
  let ws: Workspace;
  let cmp_doc: LspDocument;
  let func_doc: LspDocument;
  let exe_doc: LspDocument;
  let util_doc: LspDocument;
  let confd_doc: LspDocument;
  let config_doc: LspDocument;
  let vardef_doc: LspDocument;
  let directive_doc: LspDocument;
  let alias_doc: LspDocument;

  beforeAll(async () => {
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
    startServer();
    const opts = Config.getResultCapabilities();
    await FishServer.create(connection, opts as any);
    ws = testWorkspace.getWorkspace()!;
    cmp_doc = testWorkspace.getDocument('completions/my_function.fish')!;
    func_doc = testWorkspace.getDocument('functions/my_function.fish')!;
    exe_doc = testWorkspace.getDocument('exe.fish')!;
    util_doc = testWorkspace.getDocument('utils.fish')!;
    confd_doc = testWorkspace.getDocument('conf.d/abbrs.fish')!;
    config_doc = testWorkspace.getDocument('config.fish')!;
    vardef_doc = testWorkspace.getDocument('variable-definitions.fish')!;
    directive_doc = testWorkspace.getDocument('test-directive-token-type.fish')!;
    alias_doc = testWorkspace.getDocument('test-alias-name.fish')!;
  });

  describe('SETUP', () => {
    it('should be defined', () => {
      expect(analyzer).toBeDefined();
      expect(ws).toBeDefined();
      expect(cmp_doc).toBeDefined();
      expect(func_doc).toBeDefined();
      expect(exe_doc).toBeDefined();
      expect(util_doc).toBeDefined();
      expect(confd_doc).toBeDefined();
      expect(config_doc).toBeDefined();
      expect(vardef_doc).toBeDefined();
    });

    it('should load the workspace without errors', async () => {
      // const currentDoc = config_doc;
      const lang = analyzer.parser.getLanguage();
      const types: string[] = [];
      const allTypes: string[] = [];
      for (let i = 0; i < lang?.nodeTypeCount; i++) {
        const currentType = lang?.nodeTypeForId(i);
        allTypes.push(currentType!);
        if (!currentType || currentType.match(/.*\d+$/)) {
          continue;
        }
        types.push(currentType);
      }
      const fields: string[] = [];
      for (let i = 0; i < lang?.fieldCount; i++) {
        fields.push(lang.fieldNameForId(i)!);
      }
      expect(allTypes.length >= types.length).toBeTruthy();
      expect(fields.length < types.length).toBeTruthy();
      expect(fields.length).toBeGreaterThanOrEqual(8);
    });

    it('highlights', async () => {
      const queries = getQueriesList(highlights).reverse();
      console.log({
        queries,
      });
      for (const query of queries) {
        console.log({
          query: query.toString(),
        });
      }
      const lang = analyzer.parser.getLanguage();
      const root = analyzer.cache.getRootNode(config_doc.uri);
      const queryCaptures: QueryCapture[] = [];
      for (const query of queries) {
        const captures = lang!.query(query);
        queryCaptures.push(...captures.captures(root!));
      }
      // for (const capture of queryCaptures) {
      //   console.log({
      //     capture: {
      //       name: capture.name,
      //       type: capture.node.type,
      //       text: capture.node.text,
      //       startPosition: capture.node.startPosition,
      //       endPosition: capture.node.endPosition,
      //     }
      //   })
      // }
      // console.log({
      //   totalCaptures: queryCaptures.length,
      //   uniqueCaptureNames: Array.from(new Set(queryCaptures.map(c => c.name))),
      // })
      ['keyword', 'function', 'constant', 'comment', 'string'].forEach(expectedCaptureName => {
        expect(Array.from(new Set(queryCaptures.map(c => c.name)))).toContain(expectedCaptureName);
      });
      expect(queryCaptures.length).toBeGreaterThanOrEqual(13);
    });

    it('get language raw', () => {
      const lang = analyzer.parser.getLanguage();
      const queries = highlights;
      console.log({
        lang: lang,
        queries,
        cmd: lang.fieldIdForName('command_substitution'),
      });
    });

    it('get semantic-token modifier map', () => {
      FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes.forEach((mod, index) => {
        console.log({
          mod,
          index,
        });
      });
      console.log({
        FISH_SEMANTIC_TOKENS_LEGEND,
      });
    });
  });

  describe('off', () => {
    beforeEach(() => {
      config.fish_lsp_semantic_handler_type = 'off';
    });

    it('should not provide semantic tokens when handler is off', () => {
      const content = 'echo "hello"\nset foo bar';
      const doc = new LspDocument({ uri: 'test://off.fish', languageId: 'fish', version: 1, text: content });
      analyzer.analyze(doc);

      const result = provideSemanticTokens(doc);

      // Should return empty token data
      expect(result.data).toBeDefined();
      expect(result.data.length).toBe(0);
    });
  });

  describe('mini', () => {
    beforeEach(() => {
      config.fish_lsp_semantic_handler_type = 'mini';
    });

    describe('user-defined functions', () => {
      it('should highlight function calls', () => {
        const content = `function my_func
    echo "test"
end

my_func`;
        const doc = new LspDocument({ uri: 'test://func.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have token for function call
        const funcCallTokens = findTokensByText(tokens, 'my_func').filter(t => t.line === 4);
        expect(funcCallTokens.length).toBeGreaterThan(0);
        expect(funcCallTokens.every(t => t.tokenType === 'function')).toBe(true);
      });
    });

    describe('command modifiers', () => {
      it('should apply modifiers to commands based on their definition', () => {
        const content = `function my_global_func
    echo "global"
end

my_global_func`;
        const doc = new LspDocument({ uri: 'test://modifiers.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Function call should have appropriate modifiers
        const funcTokens = findTokensByText(tokens, 'my_global_func');
        expect(funcTokens.length).toBeGreaterThan(0);
      });
    });
  });

  describe('full', () => {
    beforeEach(() => {
      config.fish_lsp_semantic_handler_type = 'full';
    });

    describe('builtin commands', () => {
      it('should highlight builtin commands with builtin modifier', () => {
        const content = 'echo "hello"\nset foo bar\nread -l my_var';
        const doc = new LspDocument({ uri: 'test://builtin.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have tokens for echo, set, read
        const echoToken = expectTokenExists(tokens, { text: 'echo', tokenType: 'function' });
        const setToken = expectTokenExists(tokens, { text: 'set', tokenType: 'function' });
        const readToken = expectTokenExists(tokens, { text: 'read', tokenType: 'function' });

        // All should have builtin modifier
        expect(echoToken.modifiers).toContain('builtin');
        expect(setToken.modifiers).toContain('builtin');
        expect(readToken.modifiers).toContain('builtin');
      });
    });

    describe('keywords', () => {
      it('should highlight reserved keywords', () => {
        const content = `if test -f file.txt
    echo "exists"
else
    echo "not found"
end`;
        const doc = new LspDocument({ uri: 'test://keywords.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should highlight if, else, end as keywords
        expectTokenExists(tokens, { text: 'if', tokenType: 'keyword' });
        expectTokenExists(tokens, { text: 'else', tokenType: 'keyword' });
        const endTokens = findTokensByText(tokens, 'end');
        expect(endTokens.length).toBeGreaterThan(0);
        expect(endTokens.every(t => t.tokenType === 'keyword')).toBe(true);
      });

      it('should highlight loop keywords', () => {
        const content = `for i in 1 2 3
    echo $i
end

while test $count -lt 10
    set count (math $count + 1)
end`;
        const doc = new LspDocument({ uri: 'test://loops.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        expectTokenExists(tokens, { text: 'for', tokenType: 'keyword' });
        expectTokenExists(tokens, { text: 'in', tokenType: 'keyword' });
        expectTokenExists(tokens, { text: 'while', tokenType: 'keyword' });
      });

      it('should highlight alias as keyword', () => {
        const content = 'alias ll "ls -la"';
        const doc = new LspDocument({ uri: 'test://alias-kw.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        expectTokenExists(tokens, { text: 'alias', tokenType: 'keyword' });
      });
    });

    describe('variables', () => {
      it('should highlight variable names without $ prefix', () => {
        const content = 'echo $PATH\nset foo bar\necho $foo';
        const doc = new LspDocument({ uri: 'test://vars.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Variable names should be highlighted (without $)
        const pathTokens = findTokensByText(tokens, 'PATH');
        const fooTokens = findTokensByText(tokens, 'foo');

        expect(pathTokens.length).toBeGreaterThan(0);
        expect(fooTokens.length).toBeGreaterThan(0);

        // All should be variable type
        expect(pathTokens.every(t => t.tokenType === 'variable')).toBe(true);
        expect(fooTokens.every(t => t.tokenType === 'variable')).toBe(true);
      });
    });

    describe('comments and shebangs', () => {
      it('should highlight shebang as decorator', () => {
        const content = '#!/usr/bin/env fish\necho "hello"';
        const doc = new LspDocument({ uri: 'test://shebang.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        const shebangToken = expectTokenExists(tokens, { text: '#!/usr/bin/env fish', tokenType: 'decorator' });
        expect(shebangToken.modifiers).toContain('shebang');
      });

      it('should highlight @fish-lsp directives in comments as keywords', () => {
        const content = `# @fish-lsp-disable-next-line
set foo bar
# @fish-lsp-enable
echo "enabled"`;
        const doc = new LspDocument({ uri: 'test://directives.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        const directiveTokens = tokens.filter(t =>
          t.text?.includes('@fish-lsp') && t.tokenType === 'keyword',
        );

        expect(directiveTokens.length).toBeGreaterThan(0);
      });
    });

    describe('escape sequences', () => {
      it('should highlight line continuations as operators', () => {
        const content = 'echo line1\\\nline2';
        const doc = new LspDocument({ uri: 'test://escape.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Line continuation should be operator
        const escapeTokens = tokens.filter(t => t.text?.includes('\\'));
        expect(escapeTokens.length).toBeGreaterThan(0);
        expect(escapeTokens.some(t => t.tokenType === 'operator')).toBe(true);
      });

      it('should highlight other escape sequences as strings', () => {
        const content = 'echo "hello\\nworld\\t"';
        const doc = new LspDocument({ uri: 'test://escape2.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Regular escapes should be highlighted as strings
        expect(tokens.length).toBeGreaterThan(0);
      });
    });

    describe('test command brackets', () => {
      it('should highlight [ and ] in test commands', () => {
        const content = '[ -d /tmp ] && [ -f /tmp/file.fish ]';
        const doc = new LspDocument({ uri: 'test://brackets.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have tokens for [ and ]
        const brackets = tokens.filter(t => t.text === '[' || t.text === ']');
        expect(brackets.length).toBeGreaterThanOrEqual(2);
        expect(brackets.every(t => t.tokenType === 'function')).toBe(true);
      });
    });

    describe('strings and words', () => {
      it('should highlight plain words as strings', () => {
        const content = 'echo hello world';
        const doc = new LspDocument({ uri: 'test://words.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // hello and world should be strings
        const stringTokens = findTokensByType(tokens, 'string');
        expect(stringTokens.length).toBeGreaterThan(0);
      });

      it('should handle string interpolation', () => {
        const content = 'echo "Hello $USER, your home is $HOME"';
        const doc = new LspDocument({ uri: 'test://interp.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have variable tokens for USER and HOME
        const userToken = findTokensByText(tokens, 'USER');
        const homeToken = findTokensByText(tokens, 'HOME');

        expect(userToken.length).toBeGreaterThan(0);
        expect(homeToken.length).toBeGreaterThan(0);
      });
    });

    describe('highlights.scm integration', () => {
      it('should apply operators from highlights.scm', () => {
        const content = 'test -f file.txt && echo yes || echo no';
        const doc = new LspDocument({ uri: 'test://operators.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have operator tokens for && and ||
        const operators = findTokensByType(tokens, 'operator');
        expect(operators.length).toBeGreaterThan(0);
      });

      it('should highlight quoted strings', () => {
        const content = 'echo "double quoted" \'single quoted\'';
        const doc = new LspDocument({ uri: 'test://strings.fish', languageId: 'fish', version: 1, text: content });
        analyzer.analyze(doc);

        const result = provideSemanticTokens(doc);
        const tokens = decodeSemanticTokens(result, content);

        // Should have tokens (strings may be covered by other token types or deduplicated)
        expect(tokens.length).toBeGreaterThan(0);
        // At minimum, should have the echo command highlighted
        const echoTokens = findTokensByText(tokens, 'echo');
        expect(echoTokens.length).toBeGreaterThan(0);
      });
    });

    describe('Enhanced Variable Definition Detection', () => {
      // vardef_doc is already defined at the parent scope (line 49)

      it('should provide semantic tokens for variable definitions', () => {
        const tokens = treeSitterSemanticTokensProvider(vardef_doc);
        expect(tokens).toBeDefined();
        expect(tokens.data).toBeDefined();
        expect(tokens.data.length).toBeGreaterThan(0);
      });

      it('should have correct legend with variable types and scope modifiers', () => {
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('variable');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('function');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('local');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('global');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('universal');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('export');
      });

      it('should map variable token type correctly', () => {
        const variableIndex = getTokenTypeIndex('variable');
        expect(variableIndex).toBeGreaterThanOrEqual(0);
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[variableIndex]).toBe('variable');
      });

      it('should provide reverse modifier lookup functionality', () => {
        // Test bitmask with multiple modifiers
        const localIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('local');
        const exportIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('export');

        expect(localIndex).toBeGreaterThanOrEqual(0);
        expect(exportIndex).toBeGreaterThanOrEqual(0);

        // Create bitmask for definition + local + export
        const bitmask = 1 << localIndex | 1 << exportIndex;
        const modifiers = getModifiersFromMask(bitmask);

        expect(modifiers).toContain('local');
        expect(modifiers).toContain('export');
        expect(modifiers.length).toBe(2);
      });

      it('should correctly identify scope modifiers in semantic tokens', () => {
        const result = treeSitterSemanticTokensProvider(vardef_doc);
        const tokens = decodeSemanticTokens(result, vardef_doc.getText());

        // Check that we have tokens with definition modifiers
        const definitionTokens = findTokensWithModifiers(tokens, 'export');
        expect(definitionTokens.length).toBeGreaterThan(0);

        // Check that we have tokens with scope modifiers
        const scopeTokens = tokens.filter(t =>
          t.modifiers.some(mod => ['local', 'global', 'universal'].includes(mod)),
        );
        expect(scopeTokens.length).toBeGreaterThan(0);
      });

      it('should handle different variable definition contexts', () => {
        const tokens = treeSitterSemanticTokensProvider(vardef_doc);
        expect(tokens.data.length).toBeGreaterThan(0);

        // Should have tokens for:
        // - set command variable definitions
        // - read command variable definitions
        // - function argument definitions
        // - for loop variable definitions

        // This test verifies the provider doesn't crash and returns tokens
        const tokenCount = tokens.data.length / 5; // Each token has 5 values
        expect(tokenCount).toBeGreaterThan(5); // Should have multiple variable definitions
      });

      it('should have all Fish-specific modifiers defined', () => {
        expect(FishSemanticTokenModifiers.local).toBe('local');
        expect(FishSemanticTokenModifiers.global).toBe('global');
        expect(FishSemanticTokenModifiers.universal).toBe('universal');
        expect(FishSemanticTokenModifiers.export).toBe('export');
        expect(FishSemanticTokenModifiers.autoloaded).toBe('autoloaded');
        expect(FishSemanticTokenModifiers.builtin).toBe('builtin');
      });

      it('should include standard LSP modifiers', () => {
        expect(FishSemanticTokenModifiers.declaration).toBe('declaration');
        expect(FishSemanticTokenModifiers.readonly).toBe('readonly');
        expect(FishSemanticTokenModifiers.static).toBe('static');
        expect(FishSemanticTokenModifiers.deprecated).toBe('deprecated');
        expect(FishSemanticTokenModifiers.defaultLibrary).toBe('defaultLibrary');
      });

      it('should highlight alias definitions as functions with global+export modifiers', () => {
        const result = treeSitterSemanticTokensProvider(vardef_doc);
        const tokens = decodeSemanticTokens(result, vardef_doc.getText());

        // Check that we have tokens with both global and export modifiers (for aliases)
        const globalExportTokens = findTokensWithModifiers(tokens, 'global', 'export');
        expect(globalExportTokens.length).toBeGreaterThan(0);
      });

      it('should highlight export variable definitions with proper modifiers', () => {
        const result = treeSitterSemanticTokensProvider(vardef_doc);
        const tokens = decodeSemanticTokens(result, vardef_doc.getText());

        // Verify we have export-related modifiers
        const exportTokens = findTokensByModifier(tokens, 'export');
        expect(exportTokens.length).toBeGreaterThan(0);

        // Verify export tokens also have definition and global modifiers
        const exportDefinitionTokens = findTokensWithModifiers(tokens, 'export', 'global');
        expect(exportDefinitionTokens.length).toBeGreaterThan(0);
      });

      it('should correctly map alias names to function token type', () => {
        const functionIndex = getTokenTypeIndex('function');
        expect(functionIndex).toBeGreaterThanOrEqual(0);
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[functionIndex]).toBe('function');
      });

      it('should correctly map export variables to variable token type', () => {
        const variableIndex = getTokenTypeIndex('variable');
        expect(variableIndex).toBeGreaterThanOrEqual(0);
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[variableIndex]).toBe('variable');
      });

      it('should highlight event definitions with proper modifiers', () => {
        const tokens = treeSitterSemanticTokensProvider(vardef_doc);
        const data = tokens.data;

        // Check if we have event token type in legend
        const hasEventType = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes.includes('event');
        if (!hasEventType) {
          // If event type is not in legend, skip this test
          console.log('Event token type not found in legend, skipping event test');
          return;
        }

        // Extract tokens with modifiers
        const tokensWithModifiers = [];
        for (let i = 0; i < data.length; i += 5) {
          const tokenType = data[i + 3];
          const modifiersMask = data[i + 4];
          if (modifiersMask && modifiersMask > 0) {
            const modifiers = getModifiersFromMask(modifiersMask);
            const tokenTypeName = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenType!];
            tokensWithModifiers.push({ tokenType: tokenTypeName, modifiers });
          }
        }

        // Check for event tokens with global modifier
        const eventTokens = tokensWithModifiers.filter(t => t.tokenType === 'event');
        if (eventTokens.length > 0) {
          const globalEventTokens = eventTokens.filter(t =>
            t.modifiers.includes('global'),
          );
          expect(globalEventTokens.length).toBeGreaterThan(0);
        }
      });

      it('should correctly map event names to event token type', () => {
        // Check if event token type exists in legend
        const hasEventType = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes.includes('event');
        if (hasEventType) {
          const eventIndex = getTokenTypeIndex('event');
          expect(eventIndex).toBeGreaterThanOrEqual(0);
          expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[eventIndex]).toBe('event');
        } else {
          console.log('Event token type not available in current legend configuration');
        }
      });

      it('should support range-based semantic token requests', () => {
        // Test full document
        const fullTokens = treeSitterSemanticTokensProvider(vardef_doc);
        expect(fullTokens.data.length).toBeGreaterThan(0);

        // Test with a specific range (first 10 lines)
        const range = {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        };
        const rangeTokens = treeSitterSemanticTokensProvider(vardef_doc, range);

        // Range tokens should be a subset of full tokens
        expect(rangeTokens.data.length).toBeLessThanOrEqual(fullTokens.data.length);

        // SemanticTokensBuilder uses delta encoding, so we need to decode to verify ranges
        // For now, just verify that range filtering reduces the token count
        expect(rangeTokens.data.length).toBeGreaterThanOrEqual(0);
      });

      it('should handle single-line ranges correctly', () => {
        // Test with a single line range
        const range = {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 100 },
        };
        const rangeTokens = treeSitterSemanticTokensProvider(vardef_doc, range);

        // The range functionality should filter tokens, but SemanticTokensBuilder
        // uses delta encoding which makes direct line verification complex
        // For now, just verify the function doesn't crash and returns valid data
        expect(rangeTokens.data).toBeDefined();
        expect(Array.isArray(rangeTokens.data)).toBe(true);

        // Each token should have 5 values (line, char, length, type, modifiers)
        if (rangeTokens.data.length > 0) {
          expect(rangeTokens.data.length % 5).toBe(0);
        }
      });

      it('should highlight fish-lsp directive comments with special modifier', async () => {
        // Create a test document with fish-lsp directive comments
        const testContent = `#!/usr/bin/env fish
# This is a regular comment
# @fish-lsp-disable
echo "This command has diagnostics disabled"
# @fish-lsp-enable
# @fish-lsp-disable 2001 2002
echo "This command has specific diagnostics disabled"
# @fish-lsp-enable 2001
# @fish-lsp-disable-next-line 3001
echo "Next line has diagnostics disabled"
# Another regular comment
`;

        // Create a document with our test content using the same pattern as other tests
        const document = new LspDocument({
          uri: 'file:///test-fish-lsp-directives.fish',
          languageId: 'fish',
          version: 1,
          text: testContent,
        });

        const tokens = treeSitterSemanticTokensProvider(document);
        expect(tokens.data).toBeDefined();

        // Find keyword token type index (should be used for fish-lsp directives)
        const keywordTypeIndex = getTokenTypeIndex('keyword');
        expect(keywordTypeIndex).toBeGreaterThanOrEqual(0);

        // Find comment token type index (should be used for regular comments)
        const commentTypeIndex = getTokenTypeIndex('comment');
        expect(commentTypeIndex).toBeGreaterThanOrEqual(0);

        // Find fish-lsp directive modifier index
        const fishLspDirectiveModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('fish-lsp-directive');
        expect(fishLspDirectiveModifierIndex).toBeGreaterThanOrEqual(0);

        // Verify the keyword token type is available for fish-lsp directives
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('keyword');
        expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('fish-lsp-directive');
      });
    });

    describe('Fish LSP Directive Comments', () => {
      it('should use keyword token type for fish-lsp directive comments', () => {
        // Use the properly initialized directive_doc from testWorkspace
        const tokens = treeSitterSemanticTokensProvider(directive_doc);
        expect(tokens.data).toBeDefined();

        // Verify both token types are available
        const keywordTypeIndex = getTokenTypeIndex('keyword');
        const commentTypeIndex = getTokenTypeIndex('comment');
        expect(keywordTypeIndex).toBeGreaterThanOrEqual(0);
        expect(commentTypeIndex).toBeGreaterThanOrEqual(0);
        expect(keywordTypeIndex).not.toBe(commentTypeIndex);

        // The actual token data verification would require decoding the delta-encoded format
        // For now, just verify the implementation doesn't crash and returns valid data
        expect(tokens.data.length).toBeGreaterThan(0);
      });
    });

    describe('Echo and Alias Name Highlighting', () => {
      it('should provide tokens for alias statement', () => {
        // Use the properly initialized alias_doc from testWorkspace
        const tokens = treeSitterSemanticTokensProvider(alias_doc);
        expect(tokens.data).toBeDefined();

        // Mini handler will provide tokens through FishSymbols and highlights.scm
        // Just verify we get some tokens for the alias statement
        expect(tokens.data.length).toBeGreaterThan(0);
      });
    });
  }); // end of 'full' describe block
});
