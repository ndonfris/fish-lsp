import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import TestWorkspace from './test-workspace-utils';

// `set -e foo[N]` erases a single list element, not the whole variable, so it
// must NOT end `foo`'s lifetime — references after it still bind to the def.
// (Full `set -e foo` / `set -el foo` does end a local variable's lifetime.)
describe('indexed erase does not end a variable lifetime', () => {
  setLogger();
  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
  });

  const ws = TestWorkspace.create().addFiles(
    {
      relativePath: 'functions/idx.fish',
      content: [
        'function idx',                    // 0
        '    set -l local_symbol 1 2 3 4', // 1  def @ 11
        '    set -e local_symbol[4]',      // 2  index erase — NOT a full erase
        '    set --show local_symbol',     // 3  ref @ 15 (must survive)
        'end',                             // 4
      ].join('\n'),
    },
    {
      relativePath: 'functions/full.fish',
      content: [
        'function full',                   // 0
        '    set -l v 1 2',                // 1  def @ 11
        '    set -el v',                   // 2  FULL local erase — ends lifetime
        '    set --show v',                // 3  ref @ 15 (should NOT bind to def)
        'end',                             // 4
      ].join('\n'),
    },
  ).initialize();

  it('keeps references after `set -e foo[N]` (index erase)', () => {
    const doc = ws.getDocument('functions/idx.fish')!;
    const refLines = new Set(
      analyzer.getReferences(doc, { line: 1, character: 11 }).map(r => r.range.start.line),
    );
    expect(refLines.has(1)).toBe(true); // def
    expect(refLines.has(2)).toBe(true); // the `set -e local_symbol[4]` target is still a ref
    expect(refLines.has(3)).toBe(true); // post-index-erase `set --show` still bound
  });

  it('still ends a LOCAL lifetime on a full `set -el foo`', () => {
    const doc = ws.getDocument('functions/full.fish')!;
    const refLines = new Set(
      analyzer.getReferences(doc, { line: 1, character: 11 }).map(r => r.range.start.line),
    );
    expect(refLines.has(1)).toBe(true); // def
    expect(refLines.has(3)).toBe(false); // after full local erase, line 3 no longer binds
  });
});
