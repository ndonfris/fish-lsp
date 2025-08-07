import { analyzer, Analyzer } from '../src/analyze';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { getDiagnostics } from '../src/diagnostics/validate';
import { createFakeLspDocument, setLogger } from './helpers';

describe('Comprehensive Unreachable Code Detection [NEW]', () => {
  setLogger();

  beforeEach(async () => {
    await Analyzer.initialize();
  });

  // Basic cases from CLAUDE.md examples
  describe('Basic unreachable code detection', () => {
    it('should detect simple if/else with returns', () => {
      const fishCode = `
if true
    return 0
else
    return 1
end
echo "This is unreachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect switch/case with all paths exiting', () => {
      const fishCode = `
switch $var
    case 'Y' 'y' ''
        return 0
    case '*'
        return 1
end
echo "This is unreachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect conditional execution with both branches exiting', () => {
      const fishCode = `
echo a
and return 0
or return 1
echo "This is unreachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect unreachable code in function', () => {
      const fishCode = `
function test_unreachable
    if true
        return 0
    else
        return 1
    end
    echo "This is unreachable"
end

test_unreachable`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect unreachable code after exit', () => {
      const fishCode = `
command -aq nvim
and exit 0
or exit 1
echo "This is unreachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  // The main issue: nested blocks
  describe('Nested block handling (main bug)', () => {
    it('should correctly handle nested if/else - case where inner branch does not terminate all paths', () => {
      const fishCode = `
if status is-interactive
    if true
        return 0
    else
        return 1
    end
    echo "This is unreachable"
else
    echo "This is reachable"
end
echo "This is also reachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should detect the unreachable echo inside the first if branch
      expect(unreachableDiagnostics).toHaveLength(1);
      expect(unreachableDiagnostics[0]!.message.toLowerCase()).toContain('unreachable');
    });

    it('should NOT flag reachable code - case from GitHub issue', () => {
      const fishCode = `
function reachable_test
    set -l cond1 0
    set -l cond2 1
    if test $cond1 -eq 0
        if test $cond2 -eq 0
            return 1
        else
            # Do some stuff...
            # No function exit; function execution will continue after parent if block.
        end
    else
        return 1
    end
    echo reachable
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should NOT detect any unreachable code - the final echo is reachable
      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should handle deeply nested structures correctly', () => {
      const fishCode = `
function deep_nesting
    if test -n "$var1"
        if test -n "$var2"
            if test -n "$var3"
                return 0
            else
                return 1
            end
            echo "unreachable in nested if"
        else
            echo "reachable in middle else"
        end
        echo "reachable after nested if"
    else
        echo "reachable in outer else"  
    end
    echo "reachable at end"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should only detect the unreachable echo inside the innermost if
      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle nested structures with mixed control flow', () => {
      const fishCode = `
function mixed_control_flow
    if test -n "$condition"
        switch $action
            case 'exit'
                return 0
            case 'continue'
                return 1
            case '*'
                return 2
        end
        echo "unreachable after complete switch"
    else
        echo "reachable in else branch"
    end
    echo "reachable at end"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should detect unreachable code after the complete switch inside the if
      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  // Edge cases and complex scenarios
  describe('Edge cases and advanced scenarios', () => {
    it('should handle multiple levels of nesting with partial termination', () => {
      const fishCode = `
function complex_nesting
    if test -n "$outer"
        if test -n "$inner1"
            return 0
        end
        if test -n "$inner2"  
            return 1
        else
            return 2
        end
        echo "unreachable after second nested if"
    end
    echo "reachable - outer if has no else"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should detect unreachable code after the second nested if/else
      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle loops with terminal statements', () => {
      const fishCode = `
function loop_with_terminals
    for item in $list
        if test "$item" = "special"
            return 0
        else  
            return 1
        end
        echo "unreachable in loop iteration"
    end
    echo "reachable after loop"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should detect unreachable code inside the loop after the complete if/else
      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle nested conditional execution', () => {
      const fishCode = `
function nested_conditional
    if test -n "$var"
        echo "checking"
        and return 0
        or return 1
        echo "unreachable after conditional execution"
    end
    echo "reachable"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  // Negative test cases - should NOT detect unreachable code
  describe('Negative cases - reachable code', () => {
    it('should NOT detect unreachable code when if has no else', () => {
      const fishCode = `
if test -n "$var"
    return 0
end
echo "reachable - no else clause"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should NOT detect unreachable code when switch has no default case', () => {
      const fishCode = `
switch $var
    case 'a'
        return 0
    case 'b'
        return 1
end
echo "reachable - no default case"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should NOT detect unreachable code with incomplete conditional execution', () => {
      const fishCode = `
echo "test" && return 0
echo "reachable - no or clause"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should NOT detect unreachable code in nested structure with incomplete paths', () => {
      const fishCode = `
function incomplete_paths
    if test -n "$outer"
        if test -n "$inner"
            return 0
        end
        echo "reachable - inner if has no else"
    end
    echo "reachable - outer if has no else"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });
  });

  // Test console logging for tree structure analysis
  describe('Parser tree structure analysis', () => {
    it('should log syntax tree for debugging nested structures', () => {
      const fishCode = `
function debug_structure  
    if status is-interactive
        if true
            return 0
        else
            return 1
        end
        echo "This should be unreachable"
    else
        echo "This is reachable"
    end
    echo "This is also reachable"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);

      // Log the syntax tree structure for analysis
      console.log('=== SYNTAX TREE STRUCTURE ===');
      console.log('Root type:', root!.type);
      console.log('Root text preview:', root!.text.substring(0, 100) + '...');

      function logNode(node: any, indent = 0) {
        const prefix = '  '.repeat(indent);
        console.log(`${prefix}${node.type} [${node.startPosition.row}:${node.startPosition.column}-${node.endPosition.row}:${node.endPosition.column}]`);
        if (node.text.length < 50) {
          console.log(`${prefix}  text: "${node.text}"`);
        }
        for (const child of node.namedChildren) {
          logNode(child, indent + 1);
        }
      }

      // Find the function definition and log its structure
      for (const child of root!.namedChildren) {
        if (child.type === 'function_definition') {
          console.log('=== FUNCTION STRUCTURE ===');
          logNode(child);
          break;
        }
      }

      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      console.log('=== DIAGNOSTICS ===');
      console.log(`Found ${unreachableDiagnostics.length} unreachable diagnostics`);
      unreachableDiagnostics.forEach((diag, i) => {
        console.log(`${i + 1}. Line ${diag.range.start.line}: ${diag.message}`);
      });

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  // https://github.com/ndonfris/fish-lsp/issues/105
  describe('gh issue #105', () => {
    it('should not detect unreachable code in nested ifs with returns', () => {
      const fishCode = `
function reachable_test
    set -l cond1 0
    set -l cond2 1
    if test $cond1 -eq 0
        if test $cond2 -eq 0
            return 1
        else
            # Do some stuff...
            # No function exit; function execution will continue after parent \`if\` block.
        end
    else
        return 1
    end
    echo reachable
end
`;
      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
      // Should NOT detect any unreachable code - the final echo is reachable
      expect(unreachableDiagnostics).toHaveLength(0);
    });
  });

  // Extended tests for comprehensive coverage
  describe('Terminal statement variations', () => {
    it('should detect unreachable code after break statement', () => {
      const fishCode = `
for i in (seq 5)
    if test $i -eq 3
        break
        echo "unreachable after break"
    end
    echo "reachable in loop"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect unreachable code after continue statement', () => {
      const fishCode = `
for i in (seq 5)
    if test $i -eq 3
        continue
        echo "unreachable after continue"
    end
    echo "reachable in loop"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should detect unreachable code after exit statement in function', () => {
      const fishCode = `
function test_exit
    exit 1
    echo "unreachable after exit"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  describe('Switch statement edge cases', () => {
    it('should detect unreachable code with single-quoted wildcard patterns', () => {
      const fishCode = `
switch $var
    case 'option1'
        return 0
    case 'option2'
        return 1
    case '*'
        return 2
end
echo "unreachable after complete switch with quoted wildcard"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should NOT detect unreachable code with incomplete switch patterns', () => {
      const fishCode = `
switch $var
    case 'a' 'b'
        return 0
    case 'c'
        return 1
end
echo "reachable - no default case covers all possibilities"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should handle switch cases with nested control flow', () => {
      const fishCode = `
function complex_switch
    switch $argv[1]
        case 'nested'
            if test -n "$argv[2]"
                return 0
            else
                return 1
            end
            echo "unreachable after nested if/else in case"
        case '*'
            return 99
    end
    echo "unreachable after complete switch with nested structures"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should detect at least the unreachable statements
      expect(unreachableDiagnostics.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Complex conditional execution patterns', () => {
    it('should handle partial conditional execution chains', () => {
      const fishCode = `
function partial_conditional
    command -v git
    and echo "git found"
    and return 0
    # Missing 'or' branch - execution can continue
    echo "reachable - incomplete conditional chain"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should handle mixed conditional execution and control structures', () => {
      const fishCode = `
function mixed_patterns
    if test -n "$HOME"
        command -v bash
        and return 0
        or echo "bash not found"
        echo "reachable after incomplete and/or in if"
    else
        return 1
    end
    echo "reachable after if with mixed patterns"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });
  });

  describe('More deeply nested control structures', () => {
    it('should handle triple-nested if statements', () => {
      const fishCode = `
function triple_nested
    if test -n "$var1"
        if test -n "$var2" 
            if test -n "$var3"
                return 0
            else
                return 1
            end
            echo "unreachable after innermost if/else"
        else
            echo "reachable in middle else"
        end
        echo "reachable after middle if"
    else
        echo "reachable in outer else"
    end
    echo "reachable at end"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle nested switches inside if statements', () => {
      const fishCode = `
function nested_switch_in_if
    if test -n "$mode"
        switch $mode
            case 'dev'
                return 0
            case 'prod'
                return 1
            case '*'
                return 2
        end
        echo "unreachable after complete nested switch"
    else
        echo "reachable in else"
    end
    echo "reachable at end"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle nested if statements inside switch cases', () => {
      const fishCode = `
function nested_if_in_switch
    switch $action
        case 'check'
            if test -f "$file"
                return 0
            else
                return 1
            end
            echo "unreachable after nested if in switch case"
        case '*'
            return 3
    end
    echo "unreachable after complete switch with nested if"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  describe('Loop-specific scenarios', () => {
    it('should handle unreachable code in for loops with complete if/else', () => {
      const fishCode = `
function loop_with_complete_if
    for item in $items
        if test "$item" = "target"
            break
        else
            continue
        end
        echo "unreachable in loop - all if paths exit"
    end
    echo "reachable after loop"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle nested loops with terminal statements', () => {
      const fishCode = `
function nested_loops
    for outer in (seq 3)
        for inner in (seq 3)
            if test $outer -eq $inner
                return 0
            end
        end
        echo "reachable after inner loop"
    end
    echo "reachable after outer loop"  
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Inner loop doesn't have complete coverage, so code after should be reachable
      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should handle for loops with command substitution iterables', () => {
      const fishCode = `
function loop_with_substitution
    for file in (find . -name "*.fish")
        if test -r "$file"
            return 0
        else
            return 1
        end
        echo "unreachable after if/else in loop"
    end
    echo "reachable after loop"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  describe('Comment handling', () => {
    it('should allow comments after terminal statements', () => {
      const fishCode = `
function with_comments
    return 0
    # This comment should be allowed
    # Multiple comments are OK
    echo "but this code is unreachable"
    # Comments after unreachable code
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      // Should only flag the echo statement, not the comments
      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle inline comments properly', () => {
      const fishCode = `
function with_inline_comments
    if test -n "$var" # check if var is set
        return 0 # early return
    else
        return 1 # alternative return
    end
    echo "unreachable" # this should be flagged
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty if statements', () => {
      const fishCode = `
function empty_if
    if test -n "$var"
        # empty body
    end
    echo "reachable after empty if"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });

    it('should handle empty switch statements', () => {
      const fishCode = `
function empty_switch
    switch $var
        case '*'
            # empty case
    end
    echo "reachable after empty switch"
end`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(0);
    });
  });

  describe('Function-level vs top-level analysis', () => {
    it('should detect unreachable code at top level', () => {
      const fishCode = `
if test -n "$SHELL"
    exit 0
else
    exit 1
end
echo "unreachable at top level"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics).toHaveLength(1);
    });

    it('should handle mixed function and top-level unreachable code', () => {
      const fishCode = `
# Top-level unreachable code
return 0
echo "unreachable at top level"

function test_func
    exit 1
    echo "unreachable in function"
end

# More top-level code that's reachable
echo "this is reachable"`;

      const fakeDoc = createFakeLspDocument('test.fish', fishCode);
      const { root } = analyzer.analyze(fakeDoc);
      const diagnostics = getDiagnostics(root!, fakeDoc);
      const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);

      expect(unreachableDiagnostics.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Unreachable Code Detection [LEGACY]', () => {
  setLogger();

  beforeEach(async () => {
    await Analyzer.initialize();
  });

  it('should detect code after return statement', () => {
    const fishCode = `
function test_func
    return 0
    echo "unreachable"
    set var "also unreachable"
end`;
    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(2);
  });

  it('should detect code after exit statement', () => {
    const fishCode = `
function test_func
    exit 1
    echo "this will never run"
end`;
    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should detect code after complete if-else with returns', () => {
    const fishCode = `
function test_func
    if test $argv[1] = "yes"
        return 0
    else
        return 1
    end
    echo "unreachable after complete if-else"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should NOT detect code after incomplete if statement', () => {
    const fishCode = `
function test_func
    if test $argv[1] = "yes"
        return 0
    end
    echo "reachable - no else clause"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

  it('should detect code after switch with default case', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
        case "*"
            return 0
    end
    echo "unreachable after complete switch"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should NOT detect code after incomplete switch', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
    end
    echo "reachable - no default case"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

  it('should allow comments after terminal statements', () => {
    const fishCode = `
function test_func
    return 0
    # This comment should be allowed
    echo "but this is unreachable"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1); // Only the echo statement
  });

  it('should handle break and continue in loops', () => {
    const fishCode = `function test_func
    for i in (seq 10)
        if test "$i" = "5"
            break
            echo "unreachable after break"
        end
        if test "$i" = "3"
            continue
            echo "unreachable after continue"
        end
        echo "this is reachable"
    end
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(2); // after break and after continue
  });

  it('should detect code after switch with default case 2', () => {
    const fishCode = `
function test_func
    switch $argv[1]
        case "a"
            return 1
        case "b"
            return 2
        case \\*
            return 0
    end
    echo "unreachable after complete switch"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);
    console.log(fishCode);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1);
  });

  it('should detect code after conditional execution with and/or', () => {
    const fishCode = `function asdf
  set -q PATH
  and return 1
  or return 0

  echo hi # unreachable 
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(1); // Should detect the echo statement
  });

  it('should NOT detect unreachable code after incomplete conditional execution', () => {
    const fishCode = `function test_func
  set -q PATH
  and return 1
  # no 'or' clause - execution can continue

  echo "this is reachable"
end`;

    const fakeDoc = createFakeLspDocument('config.fish', fishCode);
    const { root } = analyzer.analyze(fakeDoc);

    const diagnostics = getDiagnostics(root!, fakeDoc);
    const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
    expect(unreachableDiagnostics).toHaveLength(0);
  });

  //   it('should handle complex conditional chains', () => {
  //     const fishCode = `function test_func
  //   test -f /some/file
  //   and echo "found"
  //   and return 0
  //   or echo "not found"
  //   or return 1
  //
  //   echo "unreachable because both paths terminate"
  // end`;
  //
  //     const fakeDoc = createFakeLspDocument('config.fish', fishCode);
  //     const { root } = analyzer.analyze(fakeDoc);
  //
  //     const diagnostics = getDiagnostics(root!, fakeDoc);
  //     const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
  //     expect(unreachableDiagnostics).toHaveLength(1);
  //   });
});
