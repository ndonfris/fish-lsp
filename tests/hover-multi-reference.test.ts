import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { workspaceManager } from '../src/utils/workspace-manager';
import { setLogger, createFakeLspDocument } from './helpers';
import { getMultiReferenceHover } from '../src/hover';
import * as LSP from 'vscode-languageserver';

setLogger();

/**
 * Coverage for the last-resort "multi-reference" hover: a name referenced
 * multiple times but never defined (and with no command/man docs). Built from
 * `analyzer.getUndefinedReferenceSites` and formatted by `getMultiReferenceHover`.
 */
function at(srcWithCaret: string) {
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
  const doc = createFakeLspDocument('functions/m.fish', lines.join('\n'));
  analyzer.analyze(doc);
  const position = { line, character };
  const data = analyzer.getUndefinedReferenceSites(doc, position);
  const hover = getMultiReferenceHover(analyzer, doc, position);
  const contents = hover?.contents as LSP.MarkupContent | undefined;
  const value = contents ? typeof contents === 'string' ? contents : String(contents.value ?? '') : null;
  return { data, value };
}

describe('multi-reference hover (referenced but undefined)', () => {
  beforeEach(async () => {
    await initializeParser();
    await Analyzer.initialize();
  });
  afterEach(() => workspaceManager.clear());

  it('a function called several times but never defined surfaces its usage sites', () => {
    const { data, value } = at([
      'my_undefined_helper one',
      'my_undefined_helper two',
      '‸my_undefined_helper three',
    ].join('\n'));
    expect(data).not.toBeNull();
    expect(data!.category).toBe('function');
    expect(data!.sites.length).toBe(3);
    expect(value).toContain('(*function*)');
    expect(value).toContain('my_undefined_helper');
    expect(value).toContain('referenced **3** times');
  });

  it('a variable expanded multiple times but never set surfaces its usage sites', () => {
    const { data, value } = at('echo $‸undefined_var\necho "$undefined_var"');
    expect(data).not.toBeNull();
    expect(data!.category).toBe('variable');
    expect(data!.sites.length).toBe(2);
    expect(value).toContain('(*variable*)');
    expect(value).toContain('undefined_var');
  });

  it('returns null when the function IS defined (getHover handles it)', () => {
    const { data, value } = at([
      'function defined_fn',
      '  echo hi',
      'end',
      'defined_fn',
      '‸defined_fn',
    ].join('\n'));
    expect(data).toBeNull();
    expect(value).toBeNull();
  });

  it('returns null for a single reference (not "multi")', () => {
    const { data, value } = at('‸only_once arg');
    expect(data).toBeNull();
    expect(value).toBeNull();
  });
});
