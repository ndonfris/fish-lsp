import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { workspaceManager } from '../src/utils/workspace-manager';
import { setLogger, createFakeLspDocument } from './helpers';
import * as LSP from 'vscode-languageserver';

setLogger();

/**
 * Behavioural coverage for the classifier-driven `analyzer.getHover()`. Each
 * case resolves the node under a `‸` caret through the real analyzer, so the
 * hover is produced exactly as the `onHover` handler would receive it.
 */
function hoverAt(srcWithCaret: string, uri = 'functions/h.fish'): string | null {
  const lines = srcWithCaret.split('\n');
  let line = -1;
  let character = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf('‸');
    if (c >= 0) {
      line = i; character = c; lines[i] = lines[i]!.replace('‸', ''); break;
    }
  }
  if (line < 0) throw new Error('no caret (‸) in source');
  const doc = createFakeLspDocument(uri, lines.join('\n'));
  analyzer.analyze(doc);
  const hover = analyzer.getHover(doc, { line, character });
  if (!hover) return null;
  const contents = hover.contents as LSP.MarkupContent;
  return typeof contents === 'string' ? contents : String(contents.value ?? '');
}

describe('classifier-driven getHover()', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  it('hovering a function call shows the function definition', () => {
    const value = hoverAt('function greet\n  echo hi\nend\n‸greet');
    expect(value).toBeTruthy();
    expect(value).toContain('greet');
  });

  it('hovering a `$var` expansion shows the variable definition', () => {
    const value = hoverAt('set -gx myvar 1\necho $‸myvar');
    expect(value).toBeTruthy();
    expect(value).toContain('(**variable**)');
    expect(value).toContain('myvar');
  });

  describe('a function and a same-named variable do not cross over', () => {
    const SRC_VAR = 'function cmd\n  echo hi\nend\nset -g cmd 99\necho $‸cmd';
    const SRC_CALL = 'function cmd\n  echo hi\nend\nset -g cmd 99\n‸cmd';

    it('`$cmd` resolves to the variable, never the function', () => {
      const value = hoverAt(SRC_VAR);
      expect(value).toBeTruthy();
      expect(value).toContain('(**variable**)');
    });

    it('the `cmd` call resolves to the function, never the variable', () => {
      const value = hoverAt(SRC_CALL);
      expect(value).toBeTruthy();
      expect(value).not.toContain('(**variable**)');
    });
  });

  it('a bare subcommand argument does not leak a same-named variable hover', () => {
    // `theme` in `fish_config theme` must not show the `set -g theme` hover; it
    // returns null so `onHover` falls back to command documentation.
    const value = hoverAt('set -g theme dracula\nfish_config ‸theme');
    expect(value).toBeNull();
  });

  it('a `cmd --value` call-site option resolves to the argparse flag', () => {
    const value = hoverAt([
      'function mycmd',
      "    argparse 'v/value' -- $argv",
      'end',
      'mycmd --‸value',
    ].join('\n'), 'functions/mycmd.fish');
    expect(value).toBeTruthy();
    expect(value).toContain('value');
  });

  // `fish_greeting` is one of the few names that legitimately exists as BOTH a
  // function and a variable. The local definition must win over the man page,
  // and the node category must select the right one of the two.
  describe('fish_greeting (function + variable overlap)', () => {
    // Both kinds defined in the same file.
    const BOTH = [
      'function fish_greeting',
      '  echo "hello"',
      'end',
      'set -g fish_greeting "hi"',
      'echo $fish_greeting', // line 4 — variable usage
      'fish_greeting', //       line 5 — function call
    ].join('\n');

    it('a local variable definition is shown instead of the man page', () => {
      const value = hoverAt('set -gx fish_greeting "hi there"\necho $‸fish_greeting');
      expect(value).toBeTruthy();
      expect(value).toContain('(**variable**)');
      expect(value).toContain('fish_greeting');
    });

    it('a local function definition is shown instead of the man page', () => {
      const value = hoverAt('function fish_greeting\n  echo hi\nend\n‸fish_greeting');
      expect(value).toBeTruthy();
      expect(value).toContain('fish_greeting');
      expect(value).not.toContain('(**variable**)');
    });

    it('with both defined, `$fish_greeting` resolves to the variable', () => {
      const value = hoverAt(BOTH.replace('echo $fish_greeting', 'echo $‸fish_greeting'));
      expect(value).toBeTruthy();
      expect(value).toContain('(**variable**)');
    });

    it('with both defined, the `fish_greeting` call resolves to the function', () => {
      // caret on the bare call (last line)
      const value = hoverAt(BOTH.replace(/\nfish_greeting$/, '\n‸fish_greeting'));
      expect(value).toBeTruthy();
      expect(value).not.toContain('(**variable**)');
    });
  });
});
