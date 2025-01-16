import { DiagnosticCommentsHandler, isDiagnosticComment, parseDiagnosticComment } from '../src/diagnostics/comments-handler';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes } from '../src/utils/tree-sitter';
import { createFakeLspDocument } from './helpers';
import { ErrorCodes } from '../src/diagnostics/errorCodes';
import { setLogger } from './helpers';
import { config } from '../src/cli';

let parser: Parser;

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
        invalidCodes: ['0000'],
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
          if (node.text.includes('normal')) {
            expect(handler.isCodeEnabled(1001)).toBe(true);
          } else if (node.text.includes('disabled')) {
            expect(handler.isCodeEnabled(1001)).toBe(false);
          }
        }
      });
    });
  });
});
