import { Analyzer, analyzer } from '../src/analyze';
import { isInlineVariableAssignment, parseInlineVariableAssignment, hasInlineVariables, processInlineVariables, findAllInlineVariables } from '../src/parsing/inline-variable';
import { LspDocument } from '../src/document';
import { processNestedTree } from '../src/parsing/symbol';
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

  it.each(['EMPTY', 'empty', '_empty'])('should handle an empty value for %s', (name) => {
    const code = `${name}= command`;
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;
    const firstArg = commandNode.firstNamedChild!;

    const parsed = parseInlineVariableAssignment(firstArg);
    expect(parsed).toEqual({
      name,
      value: '',
    });
  });

  it('should detect lowercase inline variable names (fish allows them)', () => {
    const code = 'foo=bar my_command';
    const tree = analyzer.parser.parse(code);
    const commandNode = tree.rootNode.firstNamedChild!;
    const firstArg = commandNode.firstNamedChild!;

    expect(hasInlineVariables(commandNode)).toBe(true);
    expect(isInlineVariableAssignment(firstArg)).toBe(true);
    expect(parseInlineVariableAssignment(firstArg)).toEqual({
      name: 'foo',
      value: 'bar',
    });
  });

  /**
   * tree-sitter-fish wraps a block statement prefixed by overrides in an
   * `override_statement`. These tests skip on grammars without that node.
   */
  describe('override_statement (overrides before a block)', () => {
    const supportsOverrideStatement = () =>
      analyzer.parser.parse('a=1 begin; end').rootNode.firstNamedChild?.type === 'override_statement';

    it('detects and extracts inline variables on `A=1 B= begin ... end`', (ctx) => {
      if (!supportsOverrideStatement()) ctx.skip();
      const code = 'A=1 B= begin\n    echo $A\nend';
      const tree = analyzer.parser.parse(code);
      testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);
      const node = tree.rootNode.firstNamedChild!;

      expect(node.type).toBe('override_statement');
      expect(hasInlineVariables(node)).toBe(true);

      const symbols = processInlineVariables(testDocument, node);
      expect(symbols.map(s => s.name)).toEqual(['A', 'B']);
      expect(symbols.every(s => s.fishKind === 'INLINE_VARIABLE')).toBe(true);
      // scoped to the wrapper, so the override covers only the wrapped block
      expect(symbols[0]!.node.type).toBe('override_statement');
    });

    it('works for `{ ... }`, if, while, for, switch, function and not', (ctx) => {
      if (!supportsOverrideStatement()) ctx.skip();
      const blocks = [
        'X=1 { echo $X }',
        'X=1 if true; echo $X; end',
        'X=1 while false; end',
        'X=1 for i in 1; echo $i; end',
        'X=1 switch $X; case 1; end',
        'X=1 function f; end',
        'X=1 not true',
      ];
      for (const code of blocks) {
        const node = analyzer.parser.parse(code).rootNode.firstNamedChild!;
        testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);
        expect(node.type, code).toBe('override_statement');
        expect(processInlineVariables(testDocument, node).map(s => s.name), code).toEqual(['X']);
      }
    });

    it('findAllInlineVariables() finds overrides on commands and on blocks', (ctx) => {
      if (!supportsOverrideStatement()) ctx.skip();
      const code = [
        'DEBUG=1 npm test',
        'HOMEBREW_NO_ENV_HINTS=1 PATH="/x:$PATH" {',
        '    brew upgrade',
        '}',
        'a=1 begin; echo $a; end | cat',
      ].join('\n');
      testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);
      const tree = analyzer.parser.parse(code);

      const names = findAllInlineVariables(testDocument, tree.rootNode).map(s => s.name);
      expect(names).toEqual(['DEBUG', 'HOMEBREW_NO_ENV_HINTS', 'PATH', 'a']);
    });

    it('keeps the wrapped block\'s symbols in the document symbol tree', (ctx) => {
      if (!supportsOverrideStatement()) ctx.skip();
      const code = [
        'a=1 function probe_fn',
        '    set -l inner 1',
        'end',
        'B=2 {',
        '    set -l in_brace 1',
        '}',
      ].join('\n');
      testDocument = LspDocument.createTextDocumentItem('file:///test.fish', code);
      const tree = analyzer.parser.parse(code);

      const symbols = processNestedTree(testDocument, tree.rootNode);
      const top = symbols.map(s => `${s.fishKind}:${s.name}`);
      expect(top).toEqual(expect.arrayContaining([
        'INLINE_VARIABLE:a',
        'FUNCTION:probe_fn',
        'INLINE_VARIABLE:B',
        'SET:in_brace',
      ]));
      const fn = symbols.find(s => s.name === 'probe_fn')!;
      expect(fn.children.map(c => c.name)).toEqual(expect.arrayContaining(['argv', 'inner']));
    });
  });
});
