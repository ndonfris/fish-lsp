import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { createFakeLspDocument } from './helpers';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { getQuickFixes } from '../src/code-actions/quick-fixes';
import { commandSyntaxDiagnostics } from '../src/diagnostics/command-syntax';
import { TextDocument } from 'vscode-languageserver-textdocument';

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
    ['true\n&& true', 'true\nand true'], ['true\n|| false', 'true\nor false'],
    ['true; && true', 'true; and true'],
  ])('offers a targeted quick fix for %j', async (code, expected) => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', code);
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const diagnostic = diagnostics.find(d => d.code === ErrorCodes.leadingConditionalOperator)!;
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

  it('honors diagnostic disable comments', async () => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', '# @fish-lsp-disable 1006\ntrue\n&& true');
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    expect(diagnostics.filter(d => d.code === ErrorCodes.leadingConditionalOperator)).toEqual([]);
  });

  it('honors next-line suppression and diagnostic limits', async () => {
    const doc = createFakeLspDocument('/tmp/command-syntax.fish', 'true\n# @fish-lsp-disable-next-line 1006\n|| false\n&& true\n&& true');
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const relevant = diagnostics.filter(d => d.code === ErrorCodes.leadingConditionalOperator);
    expect(relevant.map(d => d.range.start.line)).toEqual([3, 4]);
    expect(await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc, undefined, 1)).toHaveLength(1);
  });
});
