import { INDENT_COMMENT_REGEX, isIndentComment, parseIndentComment, processIndentComments, getEnabledIndentRanges } from '../src/parsing/comments';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { getChildNodes } from '../src/utils/tree-sitter';
import { setLogger } from './helpers';
import { LspDocument } from '../src/document';
import { TestWorkspace } from './test-workspace-utils';

let parser: Parser;

describe('Indent Comments Parsing', () => {
  setLogger(
    async () => {
      parser = await initializeParser();
    },
    async () => {
      parser.reset();
    },
  );

  describe('INDENT_COMMENT_REGEX', () => {
    it('should match valid fish_indent comments', () => {
      const validComments = [
        '# @fish_indent: off',
        '# @fish_indent: on',
        '#  @fish_indent: off',  // Extra space after #
        '#   @fish_indent: on',  // Multiple spaces after #
        '# @fish_indent: ',       // Space after colon but no value
        '# @fish_indent',         // No colon (should default to on)
      ];

      validComments.forEach(comment => {
        expect(INDENT_COMMENT_REGEX.test(comment.trim())).toBe(true);
      });
    });

    it('should not match invalid fish_indent comments', () => {
      const invalidComments = [
        '# @fish_indent: invalid', // Invalid value
        '# @fish_indent: OFF',   // Wrong case
        '# @fish_indent: On',    // Wrong case
        '@fish_indent: off',     // Missing #
        '# fish_indent: off',    // Missing @
        '# @fish_format: off',   // Wrong command
        'echo # @fish_indent: off', // Not at start of line content
      ];

      invalidComments.forEach(comment => {
        expect(INDENT_COMMENT_REGEX.test(comment.trim())).toBe(false);
      });
    });

    it('should extract correct values from valid comments', () => {
      const tests = [
        { comment: '# @fish_indent: off', expected: 'off' },
        { comment: '# @fish_indent: on', expected: 'on' },
        { comment: '#  @fish_indent: off', expected: 'off' },
        { comment: '# @fish_indent: ', expected: undefined }, // No value specified (space after colon)
        { comment: '# @fish_indent', expected: undefined }, // No colon at all
      ];

      tests.forEach(({ comment, expected }) => {
        const match = comment.trim().match(INDENT_COMMENT_REGEX);
        expect(match).toBeTruthy();
        expect(match![1]).toBe(expected);
      });
    });
  });

  describe('isIndentComment', () => {
    it('should identify indent comments correctly', () => {
      const fishCode = `
# Regular comment
# @fish_indent: off
echo "hello world"
# @fish_indent: on
function test
  echo "formatted"
end
      `;

      const tree = parser.parse(fishCode);
      const allNodes = getChildNodes(tree.rootNode);
      const commentNodes = allNodes.filter(node => node.type === 'comment');

      expect(commentNodes.length).toBe(3);
      expect(isIndentComment(commentNodes[0])).toBe(false); // Regular comment
      expect(isIndentComment(commentNodes[1])).toBe(true);  // @fish_indent: off
      expect(isIndentComment(commentNodes[2])).toBe(true);  // @fish_indent: on
    });
  });

  describe('parseIndentComment', () => {
    it('should parse indent comments correctly', () => {
      const fishCode = `
# @fish_indent: off
echo "hello"
# @fish_indent: on
echo "world"
      `;

      const tree = parser.parse(fishCode);
      const allNodes = getChildNodes(tree.rootNode);
      const commentNodes = allNodes.filter(node => node.type === 'comment');

      const offComment = parseIndentComment(commentNodes[0]);
      const onComment = parseIndentComment(commentNodes[1]);

      expect(offComment).toBeTruthy();
      expect(offComment!.indent).toBe('off');
      expect(offComment!.line).toBe(commentNodes[0].startPosition.row);
      expect(offComment!.node).toBe(commentNodes[0]);

      expect(onComment).toBeTruthy();
      expect(onComment!.indent).toBe('on');
      expect(onComment!.line).toBe(commentNodes[1].startPosition.row);
      expect(onComment!.node).toBe(commentNodes[1]);
    });

    it('should return null for non-indent comments', () => {
      const fishCode = `
# Regular comment
echo "hello"
      `;

      const tree = parser.parse(fishCode);
      const allNodes = getChildNodes(tree.rootNode);
      const commentNodes = allNodes.filter(node => node.type === 'comment');

      const result = parseIndentComment(commentNodes[0]);
      expect(result).toBe(null);
    });

    it('should default to "on" when no value is specified', () => {
      const fishCode = '# @fish_indent';
      const tree = parser.parse(fishCode);
      const commentNode = getChildNodes(tree.rootNode).find(node => node.type === 'comment');

      expect(commentNode).toBeTruthy();
      if (commentNode) {
        const result = parseIndentComment(commentNode);
        expect(result).toBeTruthy();
        expect(result!.indent).toBe('on');
      } else {
        throw new Error('Comment node not found in tree');
      }
    });
  });

  describe('processIndentComments', () => {
    it('should find all indent comments in document', () => {
      const fishCode = `
# Regular comment  
echo "start"
# @fish_indent: off
echo "unformatted code"
    echo "still unformatted"
# @fish_indent: on  
echo "formatted again"
# Another regular comment
function test
  # @fish_indent: off
  echo "local disable"
  # @fish_indent: on
end
      `;

      const tree = parser.parse(fishCode);
      const indentComments = processIndentComments(tree.rootNode);

      expect(indentComments).toHaveLength(4);
      expect(indentComments[0].indent).toBe('off');
      expect(indentComments[1].indent).toBe('on');
      expect(indentComments[2].indent).toBe('off');
      expect(indentComments[3].indent).toBe('on');
    });

    it('should return empty array when no indent comments exist', () => {
      const fishCode = `
# Regular comment
echo "hello"
function test
  echo "world"
end
      `;

      const tree = parser.parse(fishCode);
      const indentComments = processIndentComments(tree.rootNode);

      expect(indentComments).toHaveLength(0);
    });

    it('should preserve line numbers correctly', () => {
      const fishCode = `# @fish_indent: off
echo "line 1"
# @fish_indent: on`;

      const tree = parser.parse(fishCode);
      const indentComments = processIndentComments(tree.rootNode);

      expect(indentComments).toHaveLength(2);
      expect(indentComments[0].line).toBe(0); // First line
      expect(indentComments[1].line).toBe(2); // Third line
    });
  });

  describe('getEnabledIndentRanges', () => {
    it('should return full document formatting when no indent comments exist', () => {
      const content = `echo "hello world"
function test
  echo "formatted"
end`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(true);
      expect(result.formatRanges).toHaveLength(1);
    });

    it('should handle single off/on pair correctly', () => {
      const content = `echo "start"
# @fish_indent: off
echo "unformatted"
    echo "still unformatted"
# @fish_indent: on
echo "formatted again"`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(false);
      expect(result.formatRanges).toHaveLength(2);
      expect(result.formatRanges[0]).toEqual({ start: 0, end: 0 }); // First line
      expect(result.formatRanges[1]).toEqual({ start: 5, end: 5 }); // Last line
    });

    it('should handle multiple off/on pairs', () => {
      const content = `echo "line 0"
echo "line 1"
# @fish_indent: off
echo "line 3 - unformatted"
echo "line 4 - unformatted"
# @fish_indent: on
echo "line 6 - formatted"
echo "line 7 - formatted"
# @fish_indent: off
echo "line 9 - unformatted"
# @fish_indent: on
echo "line 11 - formatted"`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(false);
      expect(result.formatRanges).toHaveLength(3);
      expect(result.formatRanges[0]).toEqual({ start: 0, end: 1 }); // Lines 0-1
      expect(result.formatRanges[1]).toEqual({ start: 6, end: 7 }); // Lines 6-7
      expect(result.formatRanges[2]).toEqual({ start: 11, end: 11 }); // Line 11
    });

    it('should handle document starting with off', () => {
      const content = `# @fish_indent: off
echo "unformatted"
# @fish_indent: on
echo "formatted"`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(false);
      expect(result.formatRanges).toHaveLength(1);
      expect(result.formatRanges[0]).toEqual({ start: 3, end: 3 }); // Last line only
    });

    it('should handle document ending with off', () => {
      const content = `echo "formatted"
echo "also formatted"  
# @fish_indent: off
echo "unformatted"`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(false);
      expect(result.formatRanges).toHaveLength(1);
      expect(result.formatRanges[0]).toEqual({ start: 0, end: 1 }); // First two lines
    });

    it('should handle nested off/on comments correctly', () => {
      const content = `echo "start"
function test
  # @fish_indent: off
  echo "unformatted inside function"
  # @fish_indent: on
  echo "formatted inside function"
end
echo "end"`;
      const workspace = TestWorkspace.createSingle(content).initialize();
      const doc = workspace.focusedDocument;
      const tree = parser.parse(content);
      const result = getEnabledIndentRanges(doc, tree.rootNode);

      expect(result.fullDocumentFormatting).toBe(false);
      expect(result.formatRanges).toHaveLength(2);
      expect(result.formatRanges[0]).toEqual({ start: 0, end: 1 }); // Lines 0-1
      expect(result.formatRanges[1]).toEqual({ start: 5, end: 7 }); // Lines 5-7
    });
  });
});
