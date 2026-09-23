import { analyzer, Analyzer } from '../src/analyze';
import { createFakeLspDocument } from './helpers';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { createFixAllAction, getQuickFixes } from '../src/code-actions/quick-fixes';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { initializeParser } from '../src/parser';

describe('missing end quick fixes', () => {
  let parser: Awaited<ReturnType<typeof initializeParser>>;
  beforeAll(async () => {
    await Analyzer.initialize();
    parser = await initializeParser();
  });
  afterAll(() => parser.delete());

  it.each([
    ['echo "', 'echo ""'], ["echo '", "echo ''"],
    ['echo "hello', 'echo "hello"'], ["echo 'hello", "echo 'hello'"],
    ['alias f="foo', 'alias f="foo"'], ['echo "$(echo foo', 'echo "$(echo foo)"'],
    ['echo "done" "open', 'echo "done" "open"'], ['echo "a\\"b', 'echo "a\\"b"'],
    ['echo "a\n\nb', 'echo "a"\n\nb'], ['echo "hello  ', 'echo "hello"  '],
    ['echo "$var$bar$baz', 'echo "$var$bar$baz"'], ['echo "$var$bar$baz\necho next', 'echo "$var$bar$baz"\necho next'],
    ['set var "$(true && true\n# comment', 'set var "$(true && true)"\n# comment'],
    ['echo "hi\r\necho next', 'echo "hi"\r\necho next'], ["echo 'a b\necho next", "echo 'a b'\necho next"],
    ['echo "foo \\\nbar\necho next', 'echo "foo \\\nbar"\necho next'],
    ['echo "foo (bar', 'echo "foo (bar"'], ["echo 'foo \"bar", "echo 'foo \"bar'"],
    ['echo "path\\', 'echo "path\\\\"'], ["echo 'path\\", "echo 'path\\\\'"],
    ['echo (echo "foo', 'echo (echo "foo")'],
    ['complete -c foo -xa "\nbar\t\'bar desc\'\nbaz\t\'baz desc\'', 'complete -c foo -xa "\nbar\t\'bar desc\'\nbaz\t\'baz desc\'"'],
    ['set -q $var[1 2', 'set -q $var[1 2]'], ['set -q $var[1 2\necho next', 'set -q $var[1 2]\necho next'],
    ['[ -n "$str"', '[ -n "$str" ]'], ['[ -n "$str"\necho next', '[ -n "$str" ]\necho next'],
    ['if [ -n "$str"; echo yes; end', 'if [ -n "$str" ]; echo yes; end'],
    ['set v {1,2,3', 'set v {1,2,3}'], ['set v {1,2,3\necho next', 'set v {1,2,3}\necho next'],
    ['set -l var (echo foo', 'set -l var (echo foo)'],
    ['set vvv {1,2,3\n\nset -q $var[1 2', 'set vvv {1,2,3}\n\nset -q $var[1 2]'],
    ['set vvv {1,2,3\nset -q $var[1 2\necho next', 'set vvv {1,2,3}\nset -q $var[1 2]\necho next'],
    ["function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i", "function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i\n    end\nend"],
    ["function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i\n", "function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i\n    end\nend\n"],
    ['if true\n  if false\n    echo no\n\necho outside', 'if true\n  if false\n    echo no\n  end\necho outside\nend'],
    ['if true\n  echo a\nelse if false\n  echo b', 'if true\n  echo a\nelse if false\n  echo b\nend'],
    ['function a\n    if true\n        for x in 1\n            echo $x\nend', 'function a\n    if true\n        for x in 1\n            echo $x\n        end\n    end\nend'],
    ['set -q $var[1 2\n[ -n foo', 'set -q $var[1 2]\n[ -n foo ]'], ['set -q $var[1 2\n[\n', 'set -q $var[1 2]\n[ ]\n'],
    ['echo (a\necho "b', 'echo (a)\necho "b"'], ['set x (\n  echo "foo', 'set x (\n  echo "foo")'],
  ])('closes missing quotes, brackets and braces: %j', async (input, expected) => {
    const doc = createFakeLspDocument('/tmp/missing-quotes.fish', input);
    analyzer.analyze(doc);
    const root = analyzer.getRootNode(doc.uri)!;
    const diagnostics = await getDiagnosticsAsync(root, doc);
    const missing = diagnostics.filter(d => d.code === ErrorCodes.missingEnd);
    expect(missing).not.toHaveLength(0);
    // each closing token is its own diagnostic; fix-all closes every one
    const actions = [];
    for (const diagnostic of missing) {
      const [action] = await getQuickFixes(doc, diagnostic, analyzer);
      expect(action).toBeDefined();
      actions.push(action!);
    }
    const fixAll = createFixAllAction(doc, actions)!;
    expect(TextDocument.applyEdits(doc, fixAll.edit!.changes![doc.uri]!)).toBe(expected);
    const tree = parser.parse(expected + '\n');
    try {
      expect(tree.rootNode.hasError).toBe(false);
    } finally {
      tree.delete();
    }
  });

  it.each([
    ['set -q var "$(true && true\n\nset -q var2 {1,2,3', [
      ['0:11-0:14', 'set -q var "$(true && true)"\n\nset -q var2 {1,2,3'],
      ['2:12-2:13', 'set -q var "$(true && true\n\nset -q var2 {1,2,3}'],
    ]],
    ['set vvv {1,2,3\n\nset -q $var[1 2', [
      ['0:8-0:9', 'set vvv {1,2,3}\n\nset -q $var[1 2'],
      ['2:11-2:12', 'set vvv {1,2,3\n\nset -q $var[1 2]'],
    ]],
    // the column 0 `end` belongs to `function`, so `for` is missing its `end`
    ["function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\nend", [
      ['2:4-2:7', "function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\n    end\nend"],
    ]],
    // recovery gives the first `end` to `if`; by indentation it closes `for`
    ["function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\n\n        if true # no matching end\n\n\n    end\nend", [
      ['5:8-5:10', "function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\n\n        if true # no matching end\n        end\n\n    end\nend"],
    ]],
    // the `else` ends the `else if` branch, so the `for` inside it closes first
    ["function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\n\n        if true\n\n        else if false\n            for i in (seq 10 20)\n\n        else\n            return 1\n\n        end\n    end\nend", [
      ['8:12-8:15', "function foo_foo\n    echo 'foo_foo'\n    for i in (seq 1 10)\n        echo $i\n\n        if true\n\n        else if false\n            for i in (seq 10 20)\n            end\n        else\n            return 1\n\n        end\n    end\nend"],
    ]],
    ['if true\n    for x in 1\n        echo $x\nelse\n    echo no\nend', [
      ['1:4-1:7', 'if true\n    for x in 1\n        echo $x\n    end\nelse\n    echo no\nend'],
    ]],
    ['switch x\n    case a\n        while true\n            echo a\n    case b\n        echo b\nend', [
      ['2:8-2:13', 'switch x\n    case a\n        while true\n            echo a\n        end\n    case b\n        echo b\nend'],
    ]],
    ['begin\n    while true\n        switch x\n            case y\n                echo y\n    end\nend', [
      ['2:8-2:14', 'begin\n    while true\n        switch x\n            case y\n                echo y\n        end\n    end\nend'],
    ]],
    ['if true\n    if false\n        echo no\nend\necho after', [
      ['1:4-1:6', 'if true\n    if false\n        echo no\n    end\nend\necho after'],
    ]],
    ['function a\n    if true\n        for x in 1\n            echo $x\nend', [
      ['1:4-1:6', 'function a\n    if true\n        for x in 1\n            echo $x\n    end\nend'],
      ['2:8-2:11', 'function a\n    if true\n        for x in 1\n            echo $x\n        end\nend'],
    ]],
    ["function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i", [
      ['0:0-0:8', "function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i\nend"],
      ['3:4-3:7', "function foo_foo\n    echo 'foo_foo'\n\n    for i in (seq 1 10)\n        echo $i\n    end"],
    ]],
  ] as [string, [string, string][]][])('reports each missing closing token on its opener: %j', async (input, expected) => {
    const doc = createFakeLspDocument('/tmp/missing-closers.fish', input);
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const missing = diagnostics.filter(d => d.code === ErrorCodes.missingEnd);
    const actual: [string, string][] = [];
    for (const d of missing) {
      const [action] = await getQuickFixes(doc, d, analyzer);
      const { start, end } = d.range;
      actual.push([`${start.line}:${start.character}-${end.line}:${end.character}`, TextDocument.applyEdits(doc, action!.edit!.changes![doc.uri]!)]);
    }
    expect(actual).toEqual(expected);
  });

  it.each([
    'function a\n    for i in 1\n        if true; echo; end\n    end\nend', 'function a\n  if true\n  echo\n  end\nend',
    'function a\n    for x in 1; echo; end\nend',
    '[ -n "$str" ]', '[ -n "$str" ] && echo yes', 'if [ -n "$str" ]; echo yes; end', '[ -f foo ] 2>/dev/null',
    '[ "$a" = "]" ]', 'set -q $var[1 2]', 'set -q $var[1 2]\necho next', 'set v {1,2,3}', 'echo "a" \'b\' (echo c)',
  ])('does not report closed tokens: %j', async (input) => {
    const doc = createFakeLspDocument('/tmp/closed-tokens.fish', input);
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    expect(diagnostics.filter(d => d.code === ErrorCodes.missingEnd)).toEqual([]);
  });

  it.each([
    ['if true\n   echo is true\n\necho outside of if statement', 'if true\n   echo is true\nend\necho outside of if statement'],
    ['if true\n   echo is true', 'if true\n   echo is true\nend'],
    ['if true\n   echo is true\n', 'if true\n   echo is true\nend\n'],
    ['  if true\n    echo yes\n \t\necho outside', '  if true\n    echo yes\n  end\necho outside'],
    ['if true\r\n  echo yes\r\n\r\necho outside', 'if true\r\n  echo yes\r\nend\r\necho outside'],
    ['if true\n  echo yes\n\n\necho outside', 'if true\n  echo yes\nend\n\necho outside'],
    ['function foo\n  echo yes\n\necho outside', 'function foo\n  echo yes\nend\necho outside'],
    ['while false\n  echo yes', 'while false\n  echo yes\nend'],
    ['for x in a b\n  echo $x', 'for x in a b\n  echo $x\nend'],
    ['begin\n  echo yes', 'begin\n  echo yes\nend'],
    ['switch foo\n  case foo\n    echo yes', 'switch foo\n  case foo\n    echo yes\nend'],
    ['if true\n  echo "a\n\nb"\n\necho outside', 'if true\n  echo "a\n\nb"\nend\necho outside'],
    ['if true\n  if false\n    echo no\n\n  end\n\necho outside', 'if true\n  if false\n    echo no\n\n  end\nend\necho outside'],
  ])('inserts the terminator after the body: %j', async (input, expected) => {
    const doc = createFakeLspDocument('/tmp/missing-end-quickfix.fish', input);
    analyzer.analyze(doc);
    const diagnostics = await getDiagnosticsAsync(analyzer.getRootNode(doc.uri)!, doc);
    const diagnostic = diagnostics.find(d => d.code === ErrorCodes.missingEnd)!;
    expect(diagnostic).toBeDefined();
    const [action] = await getQuickFixes(doc, diagnostic, analyzer);
    expect(action?.title).toBe('Add missing "end"');
    expect(TextDocument.applyEdits(doc, action!.edit!.changes![doc.uri]!)).toBe(expected);
    const tree = parser.parse(expected + '\n');
    try {
      expect(tree.rootNode.hasError).toBe(false);
    } finally {
      tree.delete();
    }
  });
});
