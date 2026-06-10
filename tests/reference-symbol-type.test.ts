import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { workspaceManager } from '../src/utils/workspace-manager';
import { setLogger, createFakeLspDocument } from './helpers';
import {
  findReferenceSymbolType,
  symbolReferenceType,
  isPotentialReferenceNode,
  ReferenceSymbolType,
} from '../src/parsing/reference-candidates';

/**
 * Tests for comparing bi-directional SyntaxNode to FishSymbol filters
 * where a FishSymbol.name might exist for various types (like `function` or `variable`)
 * but we use SyntaxNode context to compare which FishSymbol's can be considered.
 *
 * Then, FishSymbol.isReference(document, node) handles determining if the scope/lifetime
 * or other location related constraints actually allow a match between the node and symbol
 */

setLogger();

/** Strip a `‸` caret marker, returning the cleaned source and its position. */
function caret(srcWithCaret: string): { text: string; line: number; character: number; } {
  const lines = srcWithCaret.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf('‸');
    if (c >= 0) {
      lines[i] = lines[i]!.replace('‸', '');
      return { text: lines.join('\n'), line: i, character: c };
    }
  }
  throw new Error('no caret (‸) in source');
}

/**
 * Classify the node at a `‸` caret marker. The node under it is resolved through
 * the real analyzer so the node we test is exactly what request handlers see.
 */
function classify(srcWithCaret: string): ReferenceSymbolType | null {
  const { text, line, character } = caret(srcWithCaret);
  const doc = createFakeLspDocument('functions/ref.fish', text);
  analyzer.analyze(doc);
  const node = analyzer.nodeAtPoint(doc.uri, line, character);
  if (!node) throw new Error(`no node at (${line},${character})`);
  return findReferenceSymbolType(node);
}

/** Analyze a caret-marked source and return the doc, the node under the caret,
 * and the caret position — for full symbol-resolution assertions. */
function docAndNode(uri: string, srcWithCaret: string) {
  const { text, line, character } = caret(srcWithCaret);
  const doc = createFakeLspDocument(uri, text);
  analyzer.analyze(doc);
  const node = analyzer.nodeAtPoint(doc.uri, line, character);
  if (!node) throw new Error(`no node at (${line},${character})`);
  return { doc, node, position: { line, character } };
}

describe('findReferenceSymbolType()', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  // [label, source-with-caret, expected]
  const cases: Array<[string, string, ReferenceSymbolType | null]> = [
    // ---- variable ----
    ['`$var` expansion', 'echo $‸myvar', 'variable'],
    ['`$var` at command position', '$‸var', 'variable'],
    ['`set NAME` definition name', 'set -l ‸counter 0', 'variable'],
    ['`set -e NAME` erase target', 'set -gx myvar 1\nset -e ‸myvar', 'variable'],
    ['`for NAME in`', 'for ‸item in a b c\n  echo $item\nend', 'variable'],
    ['`read NAME`', 'read ‸var', 'variable'],
    ['`read -p=(cmd) NAME`', 'read -p=(echo prompt) ‸var', 'variable'],
    ['`set -gx a $var` value expansion', 'set -gx a $‸var', 'variable'],
    ['`source $var/file`', 'source $‸var/file.fish', 'variable'],
    ['`string match -r` capture', "string match -r '(?<‸var>\\d+)' $x", 'variable'],
    ['`export name=value` name', 'export ‸name=value', 'variable'],

    // ---- function ----
    ['bare command name', 'function greet\n  echo hi\nend\n‸greet', 'function'],
    ['`command cmd`', 'command ‸ls -la', 'function'],
    ['`complete -c cmd` value', 'complete -c ‸mycmd -s h', 'function'],
    ['`alias name=value` value', 'alias foo=‸bar', 'function'],
    ["`bind jj 'cmd'` string", "bind jj '‸mycmd'", 'function'],
    ["`complete -a '(cmd)'` command-sub", "complete -c x -a '‸(mycmd)'", 'function'],
    ["`complete -a '(not cmd)'` command-sub", "complete -c x -a '(not ‸mycmd)'", 'function'],
    ['`function -w=cmd` wrap', 'function f -w=‸mycmd\n  echo hi\nend', 'function'],
    ['`function --wraps cmd` wrap', 'function f --wraps ‸mycmd\n  echo hi\nend', 'function'],
    ['`functions -q cmd`', 'functions -q ‸mycmd', 'function'],
    ['`type cmd`', 'type ‸mycmd', 'function'],
    ['`abbr --function cmd`', 'abbr -a x --function ‸mycmd', 'function'],
    ['`alias name value` space form', "alias myalias '‸realcmd --flag'", 'function'],

    // ---- argparse <-> complete flags (variable category) ----
    ['`complete -s X` short flag', 'complete -c mycmd -s ‸v', 'variable'],
    ['`complete -l X` long flag', 'complete -c mycmd -l ‸value', 'variable'],
    ['`complete -w cmd` wraps', 'complete -c x -w ‸mycmd', 'function'],

    // ---- command substitutions vs literal strings ----
    ['`echo cmd` literal arg', 'echo ‸mycmd', null],
    ['`echo (cmd)` command-sub', 'echo (‸mycmd)', 'function'],
    ['`echo "$(cmd)"` command-sub', 'echo "$(‸mycmd)"', 'function'],
    ["`echo '(cmd)'` single-quoted literal", "echo '‸(mycmd)'", null],
    ["`complete -n 'cmd'` condition", "complete -c x -n '‸mycmd'", 'function'],
    ['`complete -a "$vars"` variable', 'complete -c x -a "$‸myvars"', 'variable'],
    ['`cmd --value` call-site long option', 'mycmd --‸value', 'variable'],
    ['`cmd -v` call-site short option', 'mycmd -‸v', 'variable'],
    ['`cmd --value=x` call-site option-value', 'mycmd --‸value=something', 'variable'],

    // ---- set / read / for variants ----
    ['`set -U NAME` universal def', 'set -U ‸myvar value', 'variable'],
    ['`set -a NAME` append def', 'set -a ‸myvar value', 'variable'],
    ['`set -q NAME` query target', 'set -q ‸myvar', 'variable'],
    ['`read -l NAME` local', 'read -l ‸myvar', 'variable'],
    ['`for NAME in $list`', 'for ‸each in $list\n  echo $each\nend', 'variable'],

    // ---- function flag variables ----
    ['`function f -a NAME` argument-name', 'function f -a ‸argname\n  echo hi\nend', 'variable'],
    ['`function f --argument-names NAME`', 'function f --argument-names ‸argname\n  echo hi\nend', 'variable'],
    ['`function f -V NAME` inherit-variable', 'function f -V ‸invar\n  echo hi\nend', 'variable'],
    ['`function f --inherit-variable NAME`', 'function f --inherit-variable ‸invar\n  echo hi\nend', 'variable'],
    ['`function f -v NAME` on-variable', 'function f -v ‸watchvar\n  echo hi\nend', 'variable'],
    ['`function f --on-variable NAME`', 'function f --on-variable ‸watchvar\n  echo hi\nend', 'variable'],

    // ---- function event/signal/job headers ----
    ['`function f --on-event hook`', 'function f --on-event ‸myhook\n  echo hi\nend', 'emit'],
    ['`function f --on-signal SIG` (not a symbol)', 'function f --on-signal ‸SIGINT\n  echo hi\nend', null],
    ['`function f --on-job-exit caller` (not a symbol)', 'function f --on-job-exit ‸caller\n  echo hi\nend', null],

    // ---- more command/function references (creative) ----
    ['`command -v ls` wrapper arg', 'command -v ‸ls', 'function'],
    ['`builtin echo` wrapper arg', 'builtin ‸echo hi', 'function'],
    ['`type cmd` wrapper arg', 'type ‸ls', 'function'],
    ['`type -a cmd` wrapper arg', 'type -a ‸ls', 'function'],
    ['`type -q git` wrapper arg', 'type -q ‸git', 'function'],
    ['`functions -a cmd` wrapper arg', 'functions -a ‸myfunc', 'function'],
    ['`string split` subcommand (no symbol)', 'string ‸split " " $x', null],
    ['`not mycmd` negated command', 'not ‸mycmd --flag', 'function'],
    ['nested command-sub `(string upper (whoami))`', 'echo (string upper (‸whoami))', 'function'],
    ['command inside `if` block', 'if ‸mycmd\n  echo yes\nend', 'function'],
    ['piped command name', 'echo hi | ‸mycmd', 'function'],

    // ---- more variable references (creative) ----
    ['`$var` inside double quotes', 'echo "value is $‸myvar"', 'variable'],
    ['`$var` as command-sub argument', 'echo (string length $‸myvar)', 'variable'],
    ['index expression `$arr[$idx]`', 'echo $arr[$‸idx]', 'variable'],
    ['`test -n "$var"`', 'test -n "$‸myvar"', 'variable'],
    ['list slice value `set x $y[1]`', 'set -l x $‸y[1]', 'variable'],
    ['indexed set target `set arr[1] v`', 'set ‸myarr[1] value', 'variable'],
    ['`argparse v/value` definition', 'function f\n  argparse ‸v/value -- $argv\nend', 'variable'],
    ['`./path/$var` executable-path expansion', './some_path/$‸var/run', 'variable'],

    // ---- escaped line continuations ----
    ['`function fn \\` then `--argument-names a`', 'function fn \\\n    --argument-names ‸a b c\n  echo $a\nend', 'variable'],
    ['`--argument-names a b` second name across continuation', 'function fn \\\n    --argument-names a ‸b c\n  echo $b\nend', 'variable'],
    ['`functions \\` then `ls` across continuation', 'alias ls=exa\nfunctions \\\n    ‸ls', 'function'],

    // ---- negatives: descriptions / literals are not references ----
    ['`function f -d desc` description', 'function f -d ‸mydesc\n  echo hi\nend', null],
    ['`complete -d desc` description', 'complete -c foo -d ‸mydesc', null],
    ['`abbr -a name expansion` literal text', 'abbr -a gco ‸checkout', null],

    // ---- emit ----
    ['`emit hook`', 'emit ‸my_event', 'emit'],
    ['`function --on-event hook`', 'function h --on-event ‸my_event\n  echo hi\nend', 'emit'],

    // ---- null (no narrowing) ----
    ["`complete -a 'cmd'` plain string", "complete -c x -a '‸plainvalue'", null],
    ['`read -p NAME` prompt value', 'read -p ‸myprompt', null],
  ];

  it.each(cases)('classifies %s', (_label, src, expected) => {
    expect(classify(src)).toBe(expected);
  });

  // Edge case: fish re-evaluates a `complete -a` argument, so even a
  // single-quoted `'$args'` expands the variable at completion time:
  //   complete -c f.f -f -a '$args'   # $args IS a live variable reference
  // We don't model single-quote-wrapped expansions yet. Documented here for
  // visibility; revisit if it proves worth supporting.
  it.skip("single-quoted `complete -a '$var'` is a variable reference (unsupported)", () => {
    expect(classify("set -l args 1 2 3\ncomplete -c f.f -f -a '$‸args'")).toBe('variable');
  });

  // Open question from the original spec: should a bare `set` VALUE (a word that
  // could name a command, e.g. storing a function name) classify as `function`?
  //   set -gx handler my_callback   # is `my_callback` a function reference?
  // We currently return null (no narrowing) — bare argument words are only
  // command refs in command-name positions. Documented for a decision; flipping
  // it on would make every literal `set` value match same-named functions.
  it.skip('bare `set` value as a function reference (spec TBD)', () => {
    expect(classify('set -gx handler ‸my_callback')).toBe('function');
  });
});

describe('argparse <-> complete bidirectional matching', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  function nodeAtCaret(uri: string, srcWithCaret: string) {
    const lines = srcWithCaret.split('\n');
    let line = -1; let character = -1;
    for (let i = 0; i < lines.length; i++) {
      const c = lines[i]!.indexOf('‸');
      if (c >= 0) {
        line = i; character = c; break;
      }
    }
    return analyzer.nodeAtPoint(uri, line, character);
  }

  it('`complete -c mycmd -s v -l value` flags reference `mycmd`\'s argparse `v/value`', () => {
    // Caret on the `-l value` flag value, which must resolve to `_flag_value`.
    const src = [
      'function mycmd',
      "    argparse 'v/value' -- $argv",
      'end',
      'complete -c mycmd -s v -l ‸value',
    ].join('\n');
    const clean = src.replace('‸', '');
    const doc = createFakeLspDocument('functions/mycmd.fish', clean);
    analyzer.analyze(doc);

    const flagNode = nodeAtCaret(doc.uri, src)!;
    const argparseValue = analyzer.getFlatDocumentSymbols(doc.uri)
      .find(s => s.fishKind === 'ARGPARSE' && s.name === '_flag_value');
    expect(argparseValue).toBeDefined();
    // The completion flag is a reference to the argparse-defined option, because
    // `complete -c mycmd` matches the argparse symbol's parent (`mycmd`).
    expect(isPotentialReferenceNode(argparseValue!, flagNode)).toBe(true);
  });

  it('`cmd --value` call site references `cmd`\'s argparse `value`', () => {
    const src = [
      'function mycmd',
      "    argparse 'v/value' -- $argv",
      'end',
      'mycmd --‸value',
    ].join('\n');
    const clean = src.replace('‸', '');
    const doc = createFakeLspDocument('functions/mycmd.fish', clean);
    analyzer.analyze(doc);

    const optionNode = nodeAtCaret(doc.uri, src)!;
    const argparseValue = analyzer.getFlatDocumentSymbols(doc.uri)
      .find(s => s.fishKind === 'ARGPARSE' && s.name === '_flag_value');
    expect(argparseValue).toBeDefined();
    expect(isPotentialReferenceNode(argparseValue!, optionNode)).toBe(true);
  });

  it('`cmd --value=something` option-value form references `cmd`\'s argparse `value`', () => {
    const src = [
      'function mycmd',
      "    argparse 'v/value=' -- $argv",
      'end',
      'mycmd --‸value=something',
    ].join('\n');
    const clean = src.replace('‸', '');
    const doc = createFakeLspDocument('functions/mycmd.fish', clean);
    analyzer.analyze(doc);

    const optionNode = nodeAtCaret(doc.uri, src)!;
    const argparseValue = analyzer.getFlatDocumentSymbols(doc.uri)
      .find(s => s.fishKind === 'ARGPARSE' && s.name === '_flag_value');
    expect(argparseValue).toBeDefined();
    expect(isPotentialReferenceNode(argparseValue!, optionNode)).toBe(true);
  });

  it('does NOT match when the completion targets a different command', () => {
    const src = [
      'function mycmd',
      "    argparse 'v/value' -- $argv",
      'end',
      'complete -c othercmd -l ‸value',
    ].join('\n');
    const clean = src.replace('‸', '');
    const doc = createFakeLspDocument('functions/mycmd.fish', clean);
    analyzer.analyze(doc);

    const flagNode = nodeAtCaret(doc.uri, src)!;
    const argparseValue = analyzer.getFlatDocumentSymbols(doc.uri)
      .find(s => s.fishKind === 'ARGPARSE' && s.name === '_flag_value');
    expect(argparseValue).toBeDefined();
    expect(isPotentialReferenceNode(argparseValue!, flagNode)).toBe(false);
  });
});

describe('definition / usage sites resolve to their FishSymbol', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  it('`argparse v/value` definition matches both `_flag_v` and `_flag_value`', () => {
    const { doc, node } = docAndNode('functions/f.fish',
      "function f\n    argparse '‸v/value' -- $argv\nend");
    const syms = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.fishKind === 'ARGPARSE');
    const flagV = syms.find(s => s.name === '_flag_v');
    const flagValue = syms.find(s => s.name === '_flag_value');
    expect(flagV).toBeDefined();
    expect(flagValue).toBeDefined();
    expect(isPotentialReferenceNode(flagV!, node)).toBe(true);
    expect(isPotentialReferenceNode(flagValue!, node)).toBe(true);
  });

  it('`set var[2] 2` resolves to the `var` variable', () => {
    const { doc, node } = docAndNode('functions/f.fish', 'set -g var a b c\nset ‸var[2] 2');
    const varSym = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.isVariable() && s.name === 'var');
    expect(varSym).toBeDefined();
    expect(isPotentialReferenceNode(varSym!, node)).toBe(true);
  });

  it('`./path/$var` executable-path expansion resolves to the `var` variable', () => {
    const { doc, node } = docAndNode('functions/f.fish', 'set -l var bin\n./some_path/$‸var/run');
    const varSym = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.isVariable() && s.name === 'var');
    expect(varSym).toBeDefined();
    expect(node.type).toBe('variable_name');
    expect(isPotentialReferenceNode(varSym!, node)).toBe(true);
  });

  it('`functions \\` then `ls` (line continuation) resolves to the `ls` alias', () => {
    const { doc, node } = docAndNode('functions/f.fish', 'alias ls=exa\nfunctions \\\n    ‸ls');
    const aliasSym = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'ls');
    expect(aliasSym).toBeDefined();
    expect(symbolReferenceType(aliasSym!)).toBe('function');
    expect(isPotentialReferenceNode(aliasSym!, node)).toBe(true);
  });

  it('`string split` argument is not a reference and resolves to no symbol', () => {
    const { doc, node, position } = docAndNode('functions/f.fish', 'string ‸split " " $x');
    expect(findReferenceSymbolType(node)).toBeNull();
    expect(analyzer.findSymbolsForPosition(doc, position).length).toBe(0);
  });
});

describe('symbolReferenceType()', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  function firstSymbol(src: string, name: string) {
    const doc = createFakeLspDocument('functions/sym.fish', src);
    analyzer.analyze(doc);
    const sym = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === name);
    if (!sym) throw new Error(`symbol not found: ${name}`);
    return sym;
  }

  // Object form so the test title can interpolate `$label`/`$expected` without
  // dumping the (often multiline) `src` into the name.
  const cases: Array<{ label: string; src: string; name: string; expected: ReferenceSymbolType; }> = [
    { label: '`set` variable', src: 'set -gx myvar 1', name: 'myvar', expected: 'variable' },
    { label: '`set -U` universal variable', src: 'set -U myvar 1', name: 'myvar', expected: 'variable' },
    { label: '`export` variable', src: 'export PATH="/bin"', name: 'PATH', expected: 'variable' },
    { label: '`read` variable', src: 'read myvar', name: 'myvar', expected: 'variable' },
    { label: '`for` loop variable', src: 'for item in a b c\n  echo $item\nend', name: 'item', expected: 'variable' },
    { label: 'argparse flag variable', src: 'function f\n  argparse h/help -- $argv\nend', name: '_flag_help', expected: 'variable' },
    { label: 'function argument-name variable', src: 'function f -a argname\n  echo $argname\nend', name: 'argname', expected: 'variable' },
    { label: 'plain function', src: 'function greet\n  echo hi\nend', name: 'greet', expected: 'function' },
    { label: 'alias function', src: 'alias ll="ls -la"', name: 'll', expected: 'function' },
    { label: 'event handler', src: 'function on_exit --on-event fish_exit\n  echo bye\nend', name: 'fish_exit', expected: 'emit' },
  ];

  it.each(cases)('classifies $label -> $expected', ({ src, name, expected }) => {
    expect(symbolReferenceType(firstSymbol(src, name))).toBe(expected);
  });

  it('a function and a same-named variable classify into different categories', () => {
    const doc = createFakeLspDocument('functions/dual.fish', 'function cmd\n  echo hi\nend\nset -g cmd 99');
    analyzer.analyze(doc);
    const syms = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.name === 'cmd');
    const fn = syms.find(s => s.isFunction());
    const variable = syms.find(s => s.isVariable());
    expect(fn).toBeDefined();
    expect(variable).toBeDefined();
    expect(symbolReferenceType(fn!)).toBe('function');
    expect(symbolReferenceType(variable!)).toBe('variable');
  });
});

/**
 * End-to-end narrowing: `analyzer.findSymbolsForPosition` filters same-named
 * symbols by node context (it runs `symbolMatchesNodeContext`, which is driven
 * by `findReferenceSymbolType` + `symbolReferenceType`). These assert the
 * *interaction* — a node only resolves to symbols of its own category.
 */
describe('narrowing: a node resolves only to its own symbol category', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  function symbolsAt(srcWithCaret: string) {
    const { text, line, character } = caret(srcWithCaret);
    const doc = createFakeLspDocument('functions/narrow.fish', text);
    analyzer.analyze(doc);
    return analyzer.findSymbolsForPosition(doc, { line, character });
  }

  // A document where `cmd` is BOTH a function and a global variable.
  const DUAL = [
    'function cmd',
    '  echo hi',
    'end',
    'set -g cmd 99',
    'echo $cmd', // line 4 — variable usage
    'cmd', //         line 5 — command call
  ].join('\n');

  it('a `$cmd` expansion resolves only to the variable, never the function', () => {
    const found = symbolsAt('function cmd\n  echo hi\nend\nset -g cmd 99\necho $‸cmd\ncmd');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(s => symbolReferenceType(s) === 'variable')).toBe(true);
    expect(found.some(s => s.isFunction())).toBe(false);
  });

  it('a bare `cmd` call resolves only to the function, never the variable', () => {
    const found = symbolsAt('function cmd\n  echo hi\nend\nset -g cmd 99\necho $cmd\n‸cmd');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(s => symbolReferenceType(s) === 'function')).toBe(true);
    expect(found.some(s => s.isVariable())).toBe(false);
  });

  it('the dual-definition document still finds both definitions independently', () => {
    const doc = createFakeLspDocument('functions/dual2.fish', DUAL);
    analyzer.analyze(doc);
    const all = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.name === 'cmd');
    expect(all.some(s => s.isFunction())).toBe(true);
    expect(all.some(s => s.isVariable())).toBe(true);
  });
});
