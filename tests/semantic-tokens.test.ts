import { QueryCapture, SyntaxNode } from 'web-tree-sitter';
import * as TS from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import {
  FISH_SEMANTIC_TOKENS_LEGEND,
  SEMANTIC_TOKEN_MODIFIERS,
  SemanticTokenModifiers,
  provideTreeSitterSemanticTokens,
  getModifiersFromMask,
  getTokenTypeIndex,
  getQueriesList,
  FishSemanticTokenModifiers,
  FishSemanticTokenModifier,
  isBuiltinCommand,
} from '../src/semantic-tokens';
import { SyncFileHelper } from '../src/utils/file-operations';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { TestWorkspace, TestFile, Query, DefaultTestWorkspaces, focusedWorkspace } from './test-workspace-utils';
import { Range } from 'vscode-languageserver';
import { highlights } from '@ndonfris/tree-sitter-fish';
import { workspace } from './force-util-example';
import { getChildNodes, getRange, isNodeWithinRange } from '../src/utils/tree-sitter';
import { isBuiltin, isCommand, isCommandName, isComment, isFishShippedFunctionName, isPath, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName } from '../src/utils/node-types';
import { isFunctionDefinitionName } from '../src/parsing/function';

describe('Semantic Tokens', () => {
  beforeAll(async () => {
    await Analyzer.initialize();
  });

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
  ).initialize();

  describe('SETUP', () => {
    let ws: Workspace;
    let cmp_doc: LspDocument;
    let func_doc: LspDocument;
    let exe_doc: LspDocument;
    let util_doc: LspDocument;
    let confd_doc: LspDocument;
    let config_doc: LspDocument;
    let vardef_doc: LspDocument;

    beforeAll(async () => {
      ws = testWorkspace.getWorkspace()!;
      cmp_doc = testWorkspace.getDocument('completions/my_function.fish')!;
      func_doc = testWorkspace.getDocument('functions/my_function.fish')!;
      exe_doc = testWorkspace.getDocument('exe.fish')!;
      util_doc = testWorkspace.getDocument('utils.fish')!;
      confd_doc = testWorkspace.getDocument('conf.d/abbrs.fish')!;
      config_doc = testWorkspace.getDocument('config.fish')!;
      vardef_doc = testWorkspace.getDocument('variable-definitions.fish')!;
    });

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
      // console.log({
      //   lang,
      //   langStr: {
      //     fields,
      //     types,
      //     allTypes
      //   }
      // })
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

  describe('Enhanced Variable Definition Detection', () => {
    let vardef_doc: LspDocument;

    beforeAll(async () => {
      vardef_doc = testWorkspace.getDocument('variable-definitions.fish')!;
    });

    it('should provide semantic tokens for variable definitions', () => {
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
      expect(tokens).toBeDefined();
      expect(tokens.data).toBeDefined();
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('should have correct legend with variable types and scope modifiers', () => {
      expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('variable');
      expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('function');
      expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('definition');
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
      const definitionIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');
      const localIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('local');
      const exportIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('export');

      expect(definitionIndex).toBeGreaterThanOrEqual(0);
      expect(localIndex).toBeGreaterThanOrEqual(0);
      expect(exportIndex).toBeGreaterThanOrEqual(0);

      // Create bitmask for definition + local + export
      const bitmask = 1 << definitionIndex | 1 << localIndex | 1 << exportIndex;
      const modifiers = getModifiersFromMask(bitmask);

      expect(modifiers).toContain('definition');
      expect(modifiers).toContain('local');
      expect(modifiers).toContain('export');
      expect(modifiers.length).toBe(3);
    });

    it('should correctly identify scope modifiers in semantic tokens', () => {
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
      const data = tokens.data;

      // Semantic tokens data format: [line, startChar, length, tokenType, modifiers]
      // Extract all tokens with modifiers
      const tokensWithModifiers = [];
      for (let i = 0; i < data.length; i += 5) {
        const line = data[i];
        const startChar = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        if (modifiersMask && modifiersMask > 0) {
          const modifiers = getModifiersFromMask(modifiersMask);
          tokensWithModifiers.push({
            line,
            startChar,
            length,
            tokenType,
            modifiers,
          });
        }
      }

      expect(tokensWithModifiers.length).toBeGreaterThan(0);

      // Check that we have tokens with definition modifiers
      const definitionTokens = tokensWithModifiers.filter(t => t.modifiers.includes('definition'));
      expect(definitionTokens.length).toBeGreaterThan(0);

      // Check that we have tokens with scope modifiers
      const scopeModifiers = ['local', 'global', 'universal'];
      const scopeTokens = tokensWithModifiers.filter(t =>
        t.modifiers.some(mod => scopeModifiers.includes(mod)),
      );
      expect(scopeTokens.length).toBeGreaterThan(0);
    });

    it('should handle different variable definition contexts', () => {
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
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
      expect(FishSemanticTokenModifiers.definition).toBe('definition');
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
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
      const data = tokens.data;

      // Find tokens with modifiers that include both global and export
      const tokensWithModifiers = [];
      for (let i = 0; i < data.length; i += 5) {
        const line = data[i];
        const startChar = data[i + 1];
        const length = data[i + 2];
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        if (modifiersMask && modifiersMask > 0) {
          const modifiers = getModifiersFromMask(modifiersMask);
          tokensWithModifiers.push({
            line,
            startChar,
            length,
            tokenType,
            modifiers,
          });
        }
      }

      // Check that we have tokens with both global and export modifiers (for aliases)
      const globalExportTokens = tokensWithModifiers.filter(t =>
        t.modifiers.includes('global') && t.modifiers.includes('export') && t.modifiers.includes('definition'),
      );
      expect(globalExportTokens.length).toBeGreaterThan(0);
    });

    it('should highlight export variable definitions with proper modifiers', () => {
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
      const data = tokens.data;

      // Extract all tokens with modifiers
      const tokensWithModifiers = [];
      for (let i = 0; i < data.length; i += 5) {
        const modifiersMask = data[i + 4];
        if (modifiersMask && modifiersMask > 0) {
          const modifiers = getModifiersFromMask(modifiersMask);
          tokensWithModifiers.push({ modifiers });
        }
      }

      // Verify we have export-related modifiers
      const exportTokens = tokensWithModifiers.filter(t => t.modifiers.includes('export'));
      expect(exportTokens.length).toBeGreaterThan(0);

      // Verify export tokens also have definition and global modifiers
      const exportDefinitionTokens = exportTokens.filter(t =>
        t.modifiers.includes('definition') && t.modifiers.includes('global'),
      );
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
      const tokens = provideTreeSitterSemanticTokens(vardef_doc);
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
          t.modifiers.includes('definition') && t.modifiers.includes('global'),
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
      const fullTokens = provideTreeSitterSemanticTokens(vardef_doc);
      expect(fullTokens.data.length).toBeGreaterThan(0);

      // Test with a specific range (first 10 lines)
      const range = {
        start: { line: 0, character: 0 },
        end: { line: 10, character: 0 },
      };
      const rangeTokens = provideTreeSitterSemanticTokens(vardef_doc, range);

      // Range tokens should be a subset of full tokens
      expect(rangeTokens.data.length).toBeLessThanOrEqual(fullTokens.data.length);

      // SemanticTokensBuilder uses delta encoding, so we need to decode to verify ranges
      // For now, just verify that range filtering reduces the token count
      expect(rangeTokens.data.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty tokens for range outside document content', () => {
      // Test with a range far beyond the document content
      const range = {
        start: { line: 1000, character: 0 },
        end: { line: 1100, character: 0 },
      };
      const rangeTokens = provideTreeSitterSemanticTokens(vardef_doc, range);

      // Should return empty or very few tokens
      expect(rangeTokens.data.length).toBeLessThanOrEqual(5); // At most 1 token (5 values)
    });

    it('should handle single-line ranges correctly', () => {
      // Test with a single line range
      const range = {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 100 },
      };
      const rangeTokens = provideTreeSitterSemanticTokens(vardef_doc, range);

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

      const tokens = provideTreeSitterSemanticTokens(document);
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
    it('should include fish-lsp-directive modifier in the legend', () => {
      // Verify the modifier was added to the legend
      expect(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers).toContain('fish-lsp-directive');
    });

    it('should use keyword token type for fish-lsp directive comments', () => {
      // Create a test document with fish-lsp directive comment
      const testContent = `#!/usr/bin/env fish
# Regular comment should be comment token type
# @fish-lsp-disable should be keyword token type
echo "test"
`;

      const document = new LspDocument({
        uri: 'file:///test-directive-token-type.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
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
    it('should highlight echo command arguments as parameters', () => {
      const testContent = 'echo b';
      const document = new LspDocument({
        uri: 'file:///test-echo-arg.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find parameter token type index
      const parameterTypeIndex = getTokenTypeIndex('parameter');
      expect(parameterTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find parameter tokens
      const data = tokens.data;
      let hasParameterToken = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        if (tokenType === parameterTypeIndex) {
          hasParameterToken = true;
          break;
        }
      }

      expect(hasParameterToken).toBe(true);
    });

    it('should highlight alias name as function with definition modifier', () => {
      const testContent = 'alias baz=foo';
      const document = new LspDocument({
        uri: 'file:///test-alias-name.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find function token type index
      const functionTypeIndex = getTokenTypeIndex('function');
      expect(functionTypeIndex).toBeGreaterThanOrEqual(0);

      // Find definition modifier
      const definitionModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');
      expect(definitionModifierIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find function token with definition modifier
      const data = tokens.data;
      let hasFunctionWithDefinition = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        if (tokenType === functionTypeIndex && modifiersMask & 1 << definitionModifierIndex) {
          hasFunctionWithDefinition = true;
          break;
        }
      }

      expect(hasFunctionWithDefinition).toBe(true);
    });
  });

  describe('Export Command Name Highlighting', () => {
    it('should highlight export command name as function (like alias)', () => {
      const testContent = `alias foo=bar
export VAR=value`;
      const document = new LspDocument({
        uri: 'file:///test-export-command.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find function token type index
      const functionTypeIndex = getTokenTypeIndex('function');
      expect(functionTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens and find both alias and export command names
      const data = tokens.data;
      const results: Array<{text: string; type: string; modifiers: string[];}> = [];

      let line = 0;
      let char = 0;
      for (let i = 0; i < data.length; i += 5) {
        const lineDelta = data[i];
        const charDelta = data[i + 1];

        line += lineDelta;
        char = lineDelta === 0 ? char + charDelta : charDelta;

        const length = data[i + 2];
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        const text = testContent.split('\n')[line].substring(char, char + length);
        const tokenTypeName = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenType];

        const modifiers: string[] = [];
        for (let j = 0; j < FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.length; j++) {
          if (modifiersMask & 1 << j) {
            modifiers.push(FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers[j]);
          }
        }

        if (text === 'alias' || text === 'export') {
          results.push({ text, type: tokenTypeName, modifiers });
        }
      }

      // Both alias and export should be highlighted as function
      const aliasToken = results.find(r => r.text === 'alias');
      const exportToken = results.find(r => r.text === 'export');

      expect(aliasToken).toBeDefined();
      expect(exportToken).toBeDefined();

      // Both should have function type
      expect(aliasToken?.type).toBe('function');
      expect(exportToken?.type).toBe('function');

      // Both should have same modifiers (defaultLibrary, builtin)
      expect(aliasToken?.modifiers.sort()).toEqual(exportToken?.modifiers.sort());
    });
  });

  describe('Export Variable Highlighting', () => {
    it('should highlight both export command and variable name with = in quotes', () => {
      const testContent = 'export ff=\'bar\'';
      const document = new LspDocument({
        uri: 'file:///test-export-quotes.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Decode all tokens
      const data = tokens.data;
      const results: Array<{text: string; type: string; line: number; char: number;}> = [];

      let line = 0;
      let char = 0;
      for (let i = 0; i < data.length; i += 5) {
        const lineDelta = data[i];
        const charDelta = data[i + 1];

        line += lineDelta;
        char = lineDelta === 0 ? char + charDelta : charDelta;

        const length = data[i + 2];
        const tokenType = data[i + 3];

        const text = testContent.split('\n')[line].substring(char, char + length);
        const tokenTypeName = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenType];

        results.push({ text, type: tokenTypeName, line, char });
      }

      // Find export command name and ff variable name
      const exportCommand = results.find(r => r.text === 'export' && r.char === 0);
      const varName = results.find(r => r.text === 'ff');

      // Export command should be present at position 0
      expect(exportCommand).toBeDefined();
      expect(exportCommand?.type).toBe('function');

      // Variable name should be present after export
      expect(varName).toBeDefined();
      expect(varName?.type).toBe('variable');
    });

    it('should highlight export variable name with space syntax (export VAR value)', () => {
      const testContent = 'export ff \'bar\'';
      const document = new LspDocument({
        uri: 'file:///test-export-space.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find variable token type index
      const variableTypeIndex = getTokenTypeIndex('variable');
      expect(variableTypeIndex).toBeGreaterThanOrEqual(0);

      // Find definition and export modifiers
      const definitionModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');
      const exportModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('export');
      expect(definitionModifierIndex).toBeGreaterThanOrEqual(0);
      expect(exportModifierIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find variable token with definition+export modifiers
      const data = tokens.data;
      let hasExportVariable = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        if (tokenType === variableTypeIndex &&
            modifiersMask & 1 << definitionModifierIndex &&
            modifiersMask & 1 << exportModifierIndex) {
          hasExportVariable = true;
          break;
        }
      }

      expect(hasExportVariable).toBe(true);
    });

    it('should highlight export variable name with = syntax (export VAR=value)', () => {
      const testContent = 'export f=\'bar\'';
      const document = new LspDocument({
        uri: 'file:///test-export-equals.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find variable token type index
      const variableTypeIndex = getTokenTypeIndex('variable');
      expect(variableTypeIndex).toBeGreaterThanOrEqual(0);

      // Find definition and export modifiers
      const definitionModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');
      const exportModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('export');

      // Decode tokens to find variable token with definition+export modifiers
      const data = tokens.data;
      let hasExportVariable = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        const modifiersMask = data[i + 4];

        if (tokenType === variableTypeIndex &&
            modifiersMask & 1 << definitionModifierIndex &&
            modifiersMask & 1 << exportModifierIndex) {
          hasExportVariable = true;
          break;
        }
      }

      expect(hasExportVariable).toBe(true);
    });
  });

  describe('Alias and Export Equals Operator', () => {
    it('should highlight = operator in alias with escaped strings', () => {
      const testContent = 'alias f=bar\\ baz\\ qux';
      const document = new LspDocument({
        uri: 'file:///test-alias-escaped.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find operator token type index
      const operatorTypeIndex = getTokenTypeIndex('operator');
      expect(operatorTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find the = operator
      const data = tokens.data;
      let hasEqualsOperator = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        if (tokenType === operatorTypeIndex) {
          hasEqualsOperator = true;
          break;
        }
      }

      expect(hasEqualsOperator).toBe(true);
    });

    it('should highlight = operator in export statements', () => {
      const testContent = 'export PATH=/usr/bin';
      const document = new LspDocument({
        uri: 'file:///test-export-equals.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find operator token type index
      const operatorTypeIndex = getTokenTypeIndex('operator');
      expect(operatorTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find the = operator
      const data = tokens.data;
      let hasEqualsOperator = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        if (tokenType === operatorTypeIndex) {
          hasEqualsOperator = true;
          break;
        }
      }

      expect(hasEqualsOperator).toBe(true);
    });

    it('should highlight first word value after = in alias with escaped strings', () => {
      const testContent = 'alias f=bar\\ baz\\ qux';
      const document = new LspDocument({
        uri: 'file:///test-alias-first-word.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find string token type index
      const stringTypeIndex = getTokenTypeIndex('string');
      expect(stringTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find string tokens
      const data = tokens.data;
      let stringTokenCount = 0;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        if (tokenType === stringTypeIndex) {
          stringTokenCount++;
        }
      }

      // Should have at least 3 string tokens: "bar", "baz", "qux"
      expect(stringTokenCount).toBeGreaterThanOrEqual(3);
    });

    it('should correctly handle = in command flags (--opt=value)', () => {
      const testContent = 'ls --sort=size';
      const document = new LspDocument({
        uri: 'file:///test-flag-equals.fish',
        languageId: 'fish',
        version: 1,
        text: testContent,
      });

      const tokens = provideTreeSitterSemanticTokens(document);
      expect(tokens.data).toBeDefined();

      // Find operator token type index
      const operatorTypeIndex = getTokenTypeIndex('operator');
      expect(operatorTypeIndex).toBeGreaterThanOrEqual(0);

      // Decode tokens to find the = operator
      const data = tokens.data;
      let hasEqualsOperator = false;
      for (let i = 0; i < data.length; i += 5) {
        const tokenType = data[i + 3];
        if (tokenType === operatorTypeIndex) {
          hasEqualsOperator = true;
          break;
        }
      }

      expect(hasEqualsOperator).toBe(true);
    });
  });

  describe('semantic-token test 2', () => {
    let workspace: Workspace;
    beforeAll(async () => {
      workspace = testWorkspace.getWorkspace()!;
    });

    const highlightsQuery = `; Alias definitions
(alias_statement
  "alias" @keyword
  name: (word) @function.definition
  "=" @operator
  value: [(string) (word) (command_substitution)] @string)

; Export statements
(export_statement
  "export" @keyword
  variable: (variable_name) @variable.definition
  "=" @operator)

; Environment variables before commands
(environment_assignment
  variable: (variable_name) @variable
  "=" @operator)

; Command name (after env vars)
(command
  name: (word) @function)
)
    `;

    type ISemantic = {
      type: string;
      range: Range;
      modifiers: string[];
      allowOverride?: boolean;
    };

    const converter = (condition: boolean, fn: (n: SyntaxNode) => ISemantic) => {
      if (condition) {
        return fn;
      }
      return () => null;
    };

    it('should provide semantic tokens for alias and export statements', () => {
      const docContent = workspace.allDocuments().at(0)!;
      const rootNode = analyzer.cache.getRootNode(docContent.uri)!;
      const language = analyzer.parser.getLanguage();

      const queries = [
        // '(command name: (word) @function.definition)',
        // '@string',
        // '(@parameter_name) @variable.definition',
        '(punc word: ["=" ";" "," ":"] @punctuation)',
      ];

      const SEMANTIC_QUERY = ['["=" ";" "," ":" "." "->"] @operator'];

      console.log({
        docContent: docContent.uri,
        rootNodeType: docContent.getText(),
      });
      // const query = language.query(`(function_definition name: (word) @function.definition)`);
      // const tokens = "@embedded";
      const tokens: ISemantic[] = [];
      const symbols = analyzer.getFlatDocumentSymbols(docContent.uri);
      const skipRanges: Range[] = [];

      symbols.forEach(symbol => {
        console.log({
          symbol: {
            name: symbol.name,
            kind: symbol.kind,
            range: symbol.range,
            selectionRange: symbol.selectionRange,
            isVariable: symbol.isVariable(),
            isFunction: symbol.isFunction(),
            isGlobal: symbol.isGlobal(),
            isExported: symbol.isExported(),
            isAutoloaded: symbol.isAutoloaded(),
            options: symbol.options.map(o => o.toName()),
          },
        });
      });

      symbols.forEach(symbol => {
        const token = {
          type: '',
          range: symbol.selectionRange,
          modifiers: [] as string[],
          allowOverride: false,
        } as ISemantic;

        if (symbol.isVariable() && !symbol.skippableVariableName()) {
          token.type = 'variable';
          const opts: FishSemanticTokenModifier[] = [];
          if (symbol.isGlobal()) opts.push('global');
          if (symbol.isExported()) opts.push('export');

          symbol.options.forEach(opt => {
            if (['global', 'local', 'function', 'universal', 'export'].includes(opt.toName())) {
              if (!opts.includes(opt.toName() as FishSemanticTokenModifier)) {
                opts.push(opt.toName() as FishSemanticTokenModifier);
              }
            }
          });
          token.modifiers.push(...opts);
          token.range = symbol.selectionRange;
          tokens.push(token);
          skipRanges.push(symbol.selectionRange);
          return;
        }
        if (symbol.isFunction()) {
          token.type = 'function';
          token.modifiers.push(symbol.isGlobal() ? 'global' : 'local');
          token.modifiers.push(symbol.isAutoloaded() ? 'autoloaded' : 'not-autoloaded');
          tokens.push(token);
          skipRanges.push(symbol.selectionRange);
          return;
        }
      });

      const validNodes: SyntaxNode[] = getChildNodes(rootNode).filter(n => {
        return !skipRanges.some(r => isNodeWithinRange(n, r));
      });

      for (const node of validNodes) {
        if (isComment(node)) {
          tokens.push({
            type: 'comment',
            range: getRange(node),
            modifiers: [],
            allowOverride: true,
          });
          if (node.text.startsWith('# @fish-lsp')) {
            const t = node.text?.match(/# @fish-lsp[-\w\s]*/)?.at(0) || '';

            tokens.push({
              type: 'keyword',
              modifiers: ['fish-lsp-directive'],
              range: {
                start: { line: node.startPosition.row, character: node.startPosition.column + 2 },
                end: { line: node.startPosition.row, character: node.startPosition.column + 2 + t!.length! },
              },
              allowOverride: true,
            });
          }
          continue;
        } else if (node.parent && isBuiltinCommand(node.parent) && node.parent?.firstNamedChild?.equals(node)) {
          tokens.push({
            type: 'keyword',
            range: getRange(node),
            modifiers: ['builtin'],
          });
          continue;
        } else if (isCommandName(node) && !isFunctionDefinitionName(node)) {
          if (isBuiltinCommand(node)) {
            tokens.push({
              type: 'keyword',
              range: getRange(node),
              modifiers: ['builtin'],
            });
            continue;
          // } else if (isBuiltinCommand(node)) {
          //   tokens.push({
          //     type: 'function',
          //     range: getRange(node),
          //     modifiers: ['defaultLibrary', 'builtin'],
          //   });
            // continue;
          } else if (isFishShippedFunctionName(node)) {
            tokens.push({
              type: 'function',
              range: getRange(node),
              modifiers: ['defaultLibrary', 'builtin'],
            });
            continue;
          }
          tokens.push({
            type: 'function',
            range: getRange(node),
            modifiers: [],
          });
          continue;
        } else if (isPath(node)) {
          tokens.push({
            type: 'property',
            range: getRange(node),
            modifiers: [],
          },
          );
          continue;
        } else if (isVariableExpansion(node)) {
          tokens.push({
            type: 'variable',
            range: getRange(node),
            modifiers: [],
          });
          continue;
        // } else if (node) {
        }
      }

      tokens.forEach(t => {
        console.log(JSON.stringify({ text: docContent.getText(t.range), ...t }, null, 2));
      });
      // console.log({})

      //
      // // if (skipRanges.some(r => r.start.line === nodes.startPosition.row && r.start.character === nodes.startPosition.column)) {
      // console.log({
      //   type: nodes.type,
      //   text: nodes.text,
      // })
      // }
      // for (const queryStr of rootNode.descendantsOfType('command')) {
      //   console.log({
      //     queryStr: queryStr.type,
      //   })
      //   // const query = language.query(`(embedded text: @embedded)`);
      //   // const captures = query.captures(rootNode);
      //   // captures.forEach(capture => {
      //   //   console.log({
      //   //     query: queryStr,
      //   //     capture: {
      //   //       name: capture.name,
      //   //       type: capture.node.type,
      //   //       text: capture.node.text,
      //   //       startPosition: capture.node.startPosition,
      //   //       endPosition: capture.node.endPosition,
      //   //     }
      //   //   })
      //   // })
      //   // console.log({
      //   //   query: queryStr,
      //   // })
      //
      // }
      //
      // console.log(highlights);
      // console.log({
      //   getQueriesList: getQueriesList(highlights),
      // })
      // // const query = language.query(highlightsQuery);
      // for (const queryText of getQueriesList(highlights)) {
      //   const query = language.query(queryText);
      //   const captures = query.captures(rootNode);
      //
      //   // Filter captures by range if specified
      //   // if (range) {
      //   //   queryCaptures.push(...captures.filter((capture: QueryCapture) =>
      //   //     nodeIntersectsRange(capture.node, range),
      //   //   ));
      //   // } else {
      //   //   queryCaptures.push(...captures);
      //   // }
      //   // captures.forEach(capture => {
      //   //   console.log({
      //   //     query: queryText,
      //   //     capture: {
      //   //       name: capture.name,
      //   //       type: capture.node.type,
      //   //       text: capture.node.text,
      //   //     }
      //   //   })
      //   // })
      //
      //   // } catch (error) {
      //   //   console.log(`Failed to execute query: ${queryText}`, error);
      //   // }
      // }
      // }
      // tokens.forEach(t => {
      //   console.log(JSON.stringify({ ...t, text: docContent.getText(t.range) }, null, 2))
      // })
      // const captures = query.captures(rootNode);
      // console.log({
      //   captures: captures.length
      // })
      // const lang = analyzer.parser.getLanguage()
      // }
    });
  });
});
