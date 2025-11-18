import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { workspaceManager } from '../src/utils/workspace-manager';
// import { LspDocument } from '../src/document';
import { getDiagnosticsAsync } from '../src/diagnostics/async-validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { createFakeLspDocument } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { config } from '../src/config';

let parser: Parser;

describe('Conditional Execution Diagnostics', () => {
  beforeEach(async () => {
    await setupProcessEnvExecFile();
    parser = await initializeParser();
    await Analyzer.initialize();
    config.fish_lsp_strict_conditional_command_warnings = true;
  });

  afterEach(() => {
    parser.delete();
    workspaceManager.clear();
    config.fish_lsp_strict_conditional_command_warnings = false;
  });

  describe('Basic conditional execution chains', () => {
    it('should report diagnostic for set command without -q in && chain', async () => {
      const code = 'set a && set -q b';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.character).toBe(0); // Points to first 'set'
    });

    it('should report diagnostic for set command without -q in || chain', async () => {
      const code = 'set a || set -q b';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.character).toBe(0); // Points to first 'set'
    });

    it('should not report diagnostic for set -q command in && chain', async () => {
      const code = 'set -q a && set b';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });

    it('should not report diagnostic for second command in chain', async () => {
      const code = 'set -q a && set b';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      // Should not report diagnostic for the second 'set b' command
      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });
  });

  describe('If statement conditionals', () => {
    it('should report diagnostic for set command without -q in if condition', async () => {
      const code = `if set bar
   echo bar is set
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.character).toBe(3); // Points to 'set'
    });

    it('should not report diagnostic for set -q command in if condition', async () => {
      const code = `if set -q foo
   echo foo is set
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });

    it('should report diagnostic for set command without -q in else if condition', async () => {
      const code = `if set -q foo
   echo foo is set
else if set bar
   echo bar is set
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.line).toBe(2); // else if line
    });
  });

  describe('Complex nested scenarios', () => {
    it('should handle the example from requirements correctly', async () => {
      const code = `if set -ql foo_1 # no diagnostic
    set -l foo_2 # no diagnostic
    set foo_3 # no diagnostic
    set -gx foo_4 # no diagnostic
    set -q foo_4 && set -f foo_4 $foo_1 || set -f foo_4 $foo_2 # no diagnostic
else if set bar_1 # diagnostic
    set bar_2 # no diagnostic
    command -q $foo_1 || command $foo_2 # no diagnostic
else if set baz_1 || set -ql baz_2  # diagnostic on 'set' command for baz_1
    if set -q qux_1 # no diagnostic
    end
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(2);

      // Should flag 'set bar_1' and 'set baz_1'
      const line5Diagnostic = conditionalDiagnostics.find(d => d.range.start.line === 5);
      const line8Diagnostic = conditionalDiagnostics.find(d => d.range.start.line === 8);

      expect(line5Diagnostic).toBeDefined();
      expect(line8Diagnostic).toBeDefined();
    });

    it('should not report diagnostic for chained commands where first has -q', async () => {
      const code = 'set -q foo_4 && set -f foo_4 $foo_1 || set -f foo_4 $foo_2';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });

    it('should not report diagnostic for commands inside if body (only conditions are checked)', async () => {
      const code = `if set -q foo
    set bar # should not be flagged - inside body, not a condition
    set baz # should not be flagged - inside body, not a condition
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });
  });

  describe('Command types that should be checked', () => {
    it('should check command without -q flag', async () => {
      const code = 'command ls && echo found';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
    });

    it('should check type without -q flag', async () => {
      const code = 'type ls && echo found';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
    });

    it('should check string without -q flag', async () => {
      const code = 'string match "pattern" $var && echo found';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
    });

    it('should not check unrelated commands', async () => {
      const code = 'echo hello && echo world';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should not report diagnostic for set commands with command substitution', async () => {
      const code = 'set a (some_command) && echo done';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });

    it('should handle long chains correctly - only first command checked', async () => {
      const code = 'set a && set -q b && set c && set d';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.character).toBe(0); // Only first 'set a'
    });

    it('should handle mixed operators', async () => {
      const code = 'set a || set -q b && set c';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);
      expect(conditionalDiagnostics[0]?.range.start.character).toBe(0); // Points to first 'set a'
    });
  });

  describe('Alternative quiet flags', () => {
    it('should accept --quiet flag', async () => {
      const code = 'set --quiet a && echo found';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });

    it('should accept --query flag for applicable commands', async () => {
      const code = 'type --query ls && echo found';
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(0);
    });
  });

  describe('Nested conditional scenarios', () => {
    it('should flag commands in nested if statements within conditions', async () => {
      const code = `if set -q PATH
    if set YARN_PATH # should be flagged - first command in nested if condition
        set -a PATH $YARN_PATH || set -a PATH $NODE_PATH # no diagnostic - first has -a not -q, second is not first
    end
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(1);

      // Should flag the nested 'set YARN_PATH' command
      const nestedDiagnostic = conditionalDiagnostics.find(d => d.range.start.line === 1);
      expect(nestedDiagnostic).toBeDefined();
    });

    it('should handle deeply nested conditional chains', async () => {
      const code = `if set -q PATH
    if set -q NODE_PATH
        if set YARN_PATH # should be flagged
            echo "found yarn"
        else if set NPM_PATH # should be flagged  
            echo "found npm"
        end
    end
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(2);
    });

    it('should not flag commands in if bodies that are not conditions', async () => {
      const code = `if set -q foo
    set bar # should NOT be flagged - this is in the body, not the condition
    if set baz # should be flagged - this is a condition
        set qux # should NOT be flagged - this is in the body
    end
else if set quux # should be flagged - this is a condition
    set corge # should NOT be flagged - this is in the body
end`;
      const document = createFakeLspDocument('test.fish', code);
      const root = parser.parse(code).rootNode;
      const diagnostics = await getDiagnosticsAsync(root, document);

      const conditionalDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.missingQuietOption);
      expect(conditionalDiagnostics).toHaveLength(2); // Only 'set baz' and 'set quux'
    });
  });
});
