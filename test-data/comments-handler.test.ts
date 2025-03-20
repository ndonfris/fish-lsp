import { DiagnosticCommentsHandler, isDiagnosticComment, parseDiagnosticComment } from '../src/diagnostics/comments-handler';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { getChildNodes, pointToPosition } from '../src/utils/tree-sitter';
import { setLogger } from './helpers';
import { config } from '../src/config';
import { checkForInvalidDiagnosticCodes, isPossibleDiagnosticComment } from '../src/diagnostics/invalid-error-code';
import { isComment } from '../src/utils/node-types';
import { ErrorCodes } from '../src/diagnostics/errorCodes';
import { SyntaxNode } from 'web-tree-sitter';

let parser: Parser;

function logInputDiagnosticStateMap(rootNode: SyntaxNode, handler: DiagnosticCommentsHandler) {
  const lineNumbers = rootNode.text.split('\n').map((_, idx) => idx);
  console.log('-'.repeat(20));
  for (const lineNumber of lineNumbers) {
    const enabledCodes = Array.from(ErrorCodes.allErrorCodes.filter(code => handler.isCodeEnabledAtPosition(code, { line: lineNumber, character: 0 })));
    let enabledMessage = enabledCodes.join(', ');
    if (enabledCodes.length === ErrorCodes.allErrorCodes.length) {
      enabledMessage = 'all disabled';
    }
    console.log(`enabled on ${lineNumber}:`, enabledMessage);
  }
}

describe('DiagnosticCommentsHandler', () => {
  setLogger(
    async () => {
      parser = await initializeParser();
    },
    async () => {
      parser.reset();
    },
  );

  describe('isDiagnosticComment', () => {
    const validComments = [
      '# @fish-lsp-disable',
      '# @fish-lsp-enable',
      '# @fish-lsp-disable 1001',
      '# @fish-lsp-enable 1001',
      '# @fish-lsp-disable-next-line',
      '# @fish-lsp-disable-next-line 1001',
      '# @fish-lsp-disable 1001 1002 1003',
      '#@fish-lsp-disable', // No space after #
      '  # @fish-lsp-disable', // Leading whitespace
      '# @fish-lsp-disable   ', // Trailing whitespace
    ];

    const invalidComments = [
      '#not-a-diagnostic-comment',
      '# fish-lsp-disable', // Missing @
      '# @fish-lsp-disablez', // Invalid command
      '# @fish-lsp-disable-next', // Incomplete next-line
      '# @fish-lsp-disable abc', // Invalid code
      '@fish-lsp-disable', // Missing #
      '# @fish-lsp-disable-prev-line', // Invalid directive
      '# @fish-lsp-disable-all', // Invalid command
    ];

    const invalidCodes = [
      '# @fish-lsp-disable 0000',
      '# @fish-lsp-disable 1001 0000 1002',
    ];

    test.each(validComments)('should identify valid diagnostic comment: %s', (comment) => {
      const { rootNode } = parser.parse(comment);
      const commentNode = rootNode.firstChild;
      expect(commentNode).toBeTruthy();
      expect(isDiagnosticComment(commentNode!)).toBe(true);
    });

    test.each(invalidComments)('should reject invalid diagnostic comment: %s', (comment) => {
      const { rootNode } = parser.parse(comment);
      const commentNode = rootNode.firstChild;
      expect(commentNode).toBeTruthy();
      expect(isDiagnosticComment(commentNode!)).toBe(false);
    });

    invalidCodes.forEach((comment) => {
      it(`should detect invalid diagnostic codes in comment: ${comment}`, () => {
        const { rootNode } = parser.parse(comment);
        const commentNode = getChildNodes(rootNode).find(isComment)!;
        const isDiagnostic = isDiagnosticComment(commentNode);
        const diagnostics = checkForInvalidDiagnosticCodes(commentNode);
        const range = diagnostics[0]!.range;
        expect(isDiagnostic).toBe(true);
        expect(diagnostics).toHaveLength(1);
        expect(range.end.character - range.start.character).toBe(4);
      });
    });
  });

  describe('parseDiagnosticComment', () => {
    it('should parse basic enable/disable comments', () => {
      const input = '# @fish-lsp-disable';
      const { rootNode } = parser.parse(input);
      const result = parseDiagnosticComment(rootNode.firstChild!);

      expect(result).toEqual({
        action: 'disable',
        target: 'line',
        codes: [],
        lineNumber: 0,
      });
    });

    it('should parse comments with specific error codes', () => {
      const input = '# @fish-lsp-disable 1001 1002';
      const { rootNode } = parser.parse(input);
      const result = parseDiagnosticComment(rootNode.firstChild!);

      expect(result).toEqual({
        action: 'disable',
        target: 'line',
        codes: [1001, 1002],
        lineNumber: 0,
      });
    });

    it('should parse next-line directives', () => {
      const input = '# @fish-lsp-disable-next-line 1001';
      const { rootNode } = parser.parse(input);
      const result = parseDiagnosticComment(rootNode.firstChild!);

      expect(result).toEqual({
        action: 'disable',
        target: 'next-line',
        codes: [1001],
        lineNumber: 0,
      });
    });

    it('should handle invalid error codes', () => {
      const input = '# @fish-lsp-disable 1001 0000 1002';
      const { rootNode } = parser.parse(input);
      const result = parseDiagnosticComment(rootNode.firstChild!);

      expect(result).toEqual({
        action: 'disable',
        target: 'line',
        codes: [1001, 1002],
        lineNumber: 0,
      });
    });
  });

  describe('DiagnosticCommentsHandler state management', () => {
    let handler: DiagnosticCommentsHandler;

    beforeEach(() => {
      config.fish_lsp_diagnostic_disable_error_codes = [];
      handler = new DiagnosticCommentsHandler();
    });

    it('should maintain proper state stack depth', () => {
      const input = `
# @fish-lsp-disable
echo "disabled"
# @fish-lsp-disable-next-line
echo "next line disabled"
echo "back to disabled"
# @fish-lsp-enable
echo "enabled"`;

      const { rootNode } = parser.parse(input);
      getChildNodes(rootNode).forEach(node => {
        handler.handleNode(node);

        // Check stack depth at each stage
        if (node.type === 'command' && node.text.includes('disabled')) {
          expect(handler.getStackDepth()).toBeGreaterThan(1);
        } else if (node.type === 'command' && node.text.includes('enabled')) {
          expect(handler.getStackDepth()).toBe(2); // enabled doesn't replace initial state
        }
      });
    });

    it('should properly handle nested and overlapping directives', () => {
      const input = `
# @fish-lsp-disable 1001
# @fish-lsp-disable 1002
echo "both disabled"
# @fish-lsp-enable 1001
echo "only 1002 disabled"
# @fish-lsp-enable
echo "all enabled"`;

      const { rootNode } = parser.parse(input);
      getChildNodes(rootNode).forEach(node => {
        handler.handleNode(node);

        if (node.type === 'command') {
          if (node.text.includes('both disabled')) {
            expect(handler.isCodeEnabled(1001)).toBe(false);
            expect(handler.isCodeEnabled(1002)).toBe(false);
          } else if (node.text.includes('only 1002 disabled')) {
            expect(handler.isCodeEnabled(1001)).toBe(true);
            expect(handler.isCodeEnabled(1002)).toBe(false);
          } else if (node.text.includes('all enabled')) {
            expect(handler.isCodeEnabled(1001)).toBe(true);
            expect(handler.isCodeEnabled(1002)).toBe(true);
          }
        }
      });
    });

    it('should properly cleanup next-line directives', () => {
      const input = `
echo "normal"
# @fish-lsp-disable-next-line 1001
echo "disabled"
echo "back to normal"`;

      const { rootNode } = parser.parse(input);
      getChildNodes(rootNode).forEach(node => {
        handler.handleNode(node);
        if (node.type === 'command') {
          if (node.text === 'echo "normal"') {
            expect(handler.isCodeEnabled(1001)).toBe(true);
          } else if (node.text === 'echo "back to normal"') {
            expect(handler.isCodeEnabled(1001)).toBe(true);
          } else if (node.text === 'echo "disabled"') {
            expect(handler.isCodeEnabled(1001)).toBe(false);
          }
        }
      });
    });

    it('should provide line-by-line state information', () => {
      const input = `
# Normal line
# @fish-lsp-disable 1001
# @fish-lsp-disable-next-line 1002
# This line has 1002 disabled
aaa
# This line should only have 1001 disabled
# @fish-lsp-disable-next-line 1003
echo 'This line should have 1001 and 1003 disabled'
# @fish-lsp-enable
# @fish-lsp-disable-next-line
echo 'all disabled'
echo 'all enabled'

# @fish-lsp-disable`;

      const { rootNode } = parser.parse(input);
      const handler = new DiagnosticCommentsHandler();
      getChildNodes(rootNode).forEach(node => handler.handleNode(node));
      handler.finalizeStateMap(rootNode.text.split('\n').length + 1);

      // Finalize the state map
      // handler.finalizeStateMapFromRootNode(rootNode);

      // Get line-by-line state dump

      // logInputDiagnosticStateMap(rootNode, handler);
      const children = getChildNodes(rootNode);
      const checkNextLine = children.find(n => n.text === '# This line has 1002 disabled')!;
      const checkAfterNextLine = children.find(n => n.text === 'aaa')!;
      // console.log(`line 4, has 1002 ${handler.isCodeEnabledAtNode(1002, checkNextLine) ? 'enabled' : 'disabled'} | ${checkNextLine.text}`);
      // console.log(`line 5, has 1002 ${handler.isCodeEnabledAtNode(1002, checkAfterNextLine) ? 'enabled' : 'disabled'} | ${checkAfterNextLine.text}`);
      expect(handler.isCodeEnabledAtNode(1002, checkNextLine)).toBe(false);
      expect(handler.isCodeEnabledAtNode(1002, checkAfterNextLine)).toBe(true);
      //
    });
  });
});
