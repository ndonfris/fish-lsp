import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { createFakeLspDocument, createMockConnection, createTestServer } from './helpers';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { getQuickFixes } from '../src/code-actions/quick-fixes';
import { commandSyntaxDiagnostics } from '../src/diagnostics/command-syntax';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CommandNames, createExecuteCommandHandler } from '../src/command';

describe('command syntax diagnostics', () => {
  let parser: Awaited<ReturnType<typeof initializeParser>>;
  beforeAll(async () => {
    parser = await initializeParser(); await Analyzer.initialize();
  });
  afterAll(() => parser.delete());

  function check(code: string) {
    const tree = parser.parse(code);
    return { tree, diagnostics: [...commandSyntaxDiagnostics(tree.rootNode)] };
  }

  it.each(['if true\n  true\n  && true\nend', 'echo (true\n|| false)', 'echo "$(true\n&& true)"', 'true; && true', 'begin; || false; end', 'echo (true; && true)'])('checks operators inside blocks and substitutions: %j', code => {
    const { tree, diagnostics } = check(code);
    try {
      expect(diagnostics.map(d => d.code)).toEqual([ErrorCodes.leadingConditionalOperator]);
    } finally {
      tree.delete();
    }
  });

  it.each(['true\n&& true', 'true\n  || false', 'true;\n&& true', 'true # comment\n|| false', 'true\r\n\t&& true', '&& true', 'true \\\\\n&& true', 'true\n&&', 'true\n  ||'])('reports leading operators: %j', code => {
    const { tree, diagnostics } = check(code);
    try {
      expect(diagnostics.map(d => d.code)).toEqual([ErrorCodes.leadingConditionalOperator]);
      const doc = createFakeLspDocument('/tmp/command-syntax.fish', code);
      expect(['&&', '||']).toContain(doc.getText(diagnostics[0]!.range));
    } finally {
      tree.delete();
    }
  });

  it.each([
    'true\nand true', 'true\nor false', 'true && true', 'true || false',
    'true \\\n&& true', 'true \\\n|| false', 'true \\\n; and true',
    'echo "text\n&& true"', "echo 'text\n|| false'", '# && true',
    'echo "text\n&& true', "echo 'text\n|| false",
    'true\n# || false', 'echo \\&\\&', 'true &&\ntrue', 'true \\\r\n&& true',
    'echo \\; && true', 'echo "; && true"', '# ; || false', 'true; and true',
  ])('accepts valid syntax and literals: %j', code => {
    const { tree, diagnostics } = check(code);
    try {
      expect(diagnostics).toEqual([]);
    } finally {
      tree.delete();
    }
  });

  it.each([
    'function foo -d; end', 'function foo --description\nend', 'function foo -d',
    'complete -c', 'complete --command', 'complete -c foo -s', 'complete -c foo --short-option',
    'complete -c foo -l', 'complete -c foo --long-option', 'complete -c foo -d',
    'complete --description', 'complete -xd',
    'complete -d \\\n',
  ])('requires the final option value: %j', code => {
    const { tree, diagnostics } = check(code);
    try {
      expect(diagnostics.map(d => d.code)).toEqual([ErrorCodes.missingOptionValue]);
    } finally {
      tree.delete();
    }
  });

  it.each([
    'function foo -d ""; end', 'function foo -d desc\nend', 'function foo --description=""; end',
    'function foo -d \\\n desc; end', 'complete -c cmd -s s -l long -d "description"',
    'complete -ccmd -ss -llong -ddesc', 'complete -xcfoo -s s', 'complete --description=',
    'complete -d $description', 'complete -d (echo desc)', 'complete -d -s',
    'complete -a -d', 'complete -- -d', 'echo complete -d', 'echo "function foo -d"',
    'abbr --description desc foo bar', 'abbr -- foo -d', 'function foo; echo -d; end',
    'abbr --description', 'abbr --add foo bar -d', 'abbr --description=text foo bar',
  ])('accepts supplied values and ignores unrelated text: %j', code => {
    const { tree, diagnostics } = check(code);
    try {
      expect(diagnostics).toEqual([]);
    } finally {
      tree.delete();
    }
  });

  it.each([
    ['true\n&& true', 'true\nand true'], ['true\n|| false', 'true\nor false'],
    ['true; && true', 'true; and true'],
    ['function foo -d; end', 'function foo -d ""; end'], ['complete -c foo -d', 'complete -c foo -d ""'],
  ])('offers a targeted quick fix for %j', async (code, expected) => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', code);
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const diagnostic = diagnostics.find(d => d.code === ErrorCodes.leadingConditionalOperator || d.code === ErrorCodes.missingOptionValue)!;
    expect(diagnostic).toBeDefined();
    const actions = await getQuickFixes(doc, diagnostic, analyzer);
    expect(actions).toHaveLength(1);
    const fixed = TextDocument.applyEdits(doc, actions[0]!.edit!.changes![doc.uri]!);
    expect(fixed).toBe(expected);
    const { tree, diagnostics: after } = check(fixed);
    try {
      expect(after).toEqual([]);
    } finally {
      tree.delete();
    }
  });

  it('does not invent a value for a missing command name', async () => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', 'complete -c');
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    expect(await getQuickFixes(doc, diagnostics.find(d => d.code === ErrorCodes.missingOptionValue)!, analyzer)).toEqual([]);
  });

  it('honors diagnostic disable comments', async () => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', '# @fish-lsp-disable 1006 1007\ntrue\n&& true\ncomplete -c');
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    expect(diagnostics.filter(d => d.code === ErrorCodes.leadingConditionalOperator || d.code === ErrorCodes.missingOptionValue)).toEqual([]);
  });

  it('honors next-line suppression and diagnostic limits', async () => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', 'true\n# @fish-lsp-disable-next-line 1006\n|| false\n&& true\ncomplete -d');
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const relevant = diagnostics.filter(d => d.code === ErrorCodes.leadingConditionalOperator || d.code === ErrorCodes.missingOptionValue);
    expect(relevant.map(d => d.range.start.line)).toEqual([3, 4]);
    expect(await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc, undefined, 1)).toHaveLength(1);
  });

  it.each([true, false])('adds cursor placement to the actual description action only with client support: %j', async supported => {
    const handle = await createTestServer({ params: { capabilities: { window: { showDocument: { support: supported } } } } });
    try {
      const doc = createFakeLspDocument('/tmp/command-syntax.fish', 'complete -d');
      analyzer.analyze(doc);
      const diagnostic = (await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc)).find(d => d.code === ErrorCodes.missingOptionValue)!;
      const [action] = await getQuickFixes(doc, diagnostic, analyzer);
      if (supported) expect(action?.command).toMatchObject({ command: CommandNames.SELECT_QUICK_FIX_POSITION, arguments: [doc.uri, { line: 0, character: 13 }] });
      else expect(action?.command).toBeUndefined();
    } finally {
      await handle.shutdown();
    }
  });

  it.each([true, false])('places the description cursor only when showDocument is supported: %j', async supported => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', 'complete -d ""');
    const connection = createMockConnection();
    const handler = createExecuteCommandHandler(connection, supported);
    const position = { line: 0, character: 13 };
    await handler({ command: CommandNames.SELECT_QUICK_FIX_POSITION, arguments: [doc.uri, position] });
    if (supported) expect(connection.window.showDocument).toHaveBeenCalledWith({ uri: doc.uri, takeFocus: true, selection: { start: position, end: position } });
    else expect(connection.window.showDocument).not.toHaveBeenCalled();
  });
});
