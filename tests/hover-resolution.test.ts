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
});
