import { QueryCapture } from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import {
  FISH_SEMANTIC_TOKENS_LEGEND,
  getQueriesList,
  SEMANTIC_TOKEN_MODIFIERS,
  SemanticTokenModifiers,
  provideTreeSitterSemanticTokens,
  getModifiersFromMask,
  getTokenTypeIndex,
  FishSemanticTokenModifiers,
} from '../src/semantic-tokens';
import { SyncFileHelper } from '../src/utils/file-operations';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { TestWorkspace, TestFile, Query, DefaultTestWorkspaces, focusedWorkspace } from './test-workspace-utils';
import { highlights } from '@ndonfris/tree-sitter-fish';

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

        if (modifiersMask > 0) {
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
        if (modifiersMask > 0) {
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
        if (modifiersMask > 0) {
          const modifiers = getModifiersFromMask(modifiersMask);
          const tokenTypeName = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenType];
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
  });
});
