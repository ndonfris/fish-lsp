import { Analyzer, analyzer } from '../src/analyze';
import { isInlineVariableAssignment, parseInlineVariableAssignment, hasInlineVariables, processInlineVariables, findAllInlineVariables } from '../src/parsing/inline-variable';
import { LspDocument } from '../src/document';
import Parser from 'web-tree-sitter';

describe('Inline Variable Parsing', () => {
  let parser: Parser;
  let testDocument: LspDocument;

  beforeAll(async () => {
    await Analyzer.initialize();
  });

  beforeEach(() => {
    testDocument = LspDocument.createTextDocumentItem('file:///test.fish', '');
    parser = analyzer.parser;
  });

  it('should detect inline variable assignments', () => {
    const code = 'NVIM_APPNAME=nvim-lua nvim';
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;

    expect(hasInlineVariables(commandNode)).toBe(true);
  });

  it('should parse variable name and value correctly', () => {
    const code = 'DEBUG=1 npm test';
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;
    const firstArg = commandNode.firstNamedChild!;

    expect(isInlineVariableAssignment(firstArg)).toBe(true);

    const parsed = parseInlineVariableAssignment(firstArg);
    expect(parsed).toEqual({
      name: 'DEBUG',
      value: '1',
    });
  });

  it('should extract FishSymbols for inline variables', () => {
    const code = 'PATH=/usr/local/bin:$PATH EDITOR=nvim command arg1 arg2';
    const tree = analyzer.parser.parse(code);
    testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);

    const commandNode = tree.rootNode.firstNamedChild!;
    const symbols = processInlineVariables(testDocument, commandNode);

    expect(symbols).toHaveLength(2);
    expect(symbols[0]?.name).toBe('PATH');
    expect(symbols[1]?.name).toBe('EDITOR');
    expect(symbols[0]?.fishKind).toBe('INLINE_VARIABLE');
  });

  it('should find all inline variables in a document', () => {
    const code = `
DEBUG=1 npm test
NVIM_APPNAME=nvim-lua nvim
normal_command without variables
HTTP_PROXY=proxy:8080 curl example.com
`;
    const tree = analyzer.parser.parse(code);
    testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);

    const symbols = findAllInlineVariables(testDocument, tree.rootNode);

    expect(symbols).toHaveLength(3);
    expect(symbols.map(s => s.name)).toEqual(['DEBUG', 'NVIM_APPNAME', 'HTTP_PROXY']);
  });

  it('should not detect regular variable assignments as inline', () => {
    const code = 'set DEBUG 1';
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;

    expect(hasInlineVariables(commandNode)).toBe(false);
  });

  it('should handle empty values', () => {
    const code = 'EMPTY= command';
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;
    const firstArg = commandNode.firstNamedChild!;

    const parsed = parseInlineVariableAssignment(firstArg);
    expect(parsed).toEqual({
      name: 'EMPTY',
      value: '',
    });
  });
});
