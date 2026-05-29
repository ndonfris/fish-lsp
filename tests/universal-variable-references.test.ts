import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import TestWorkspace from './test-workspace-utils';

describe('universal/global variable references are position-independent', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
  });

  function refsOf(ws: TestWorkspace, line: number, character: number): Set<string> {
    const doc = ws.getDocument('conf.d/pw.fish')!;
    return new Set(
      analyzer.getReferences(doc, { line, character })
        .map(r => `${r.range.start.line}:${r.range.start.character}`),
    );
  }

  const ws = TestWorkspace.create().addFiles({
    relativePath: 'conf.d/pw.fish',
    content: [
      'echo $pw',          // 0  ref BEFORE any def (universal persists across sessions)
      'set -Ux pw $PWD',   // 1  def #1  (pw @ 8)
      'echo $pw',          // 2  ref between defs
      'set -Ux pw $PWD',   // 3  def #2  (pw @ 8)  <-- redefinition, NOT an erase
      'echo $pw',          // 4  ref after def #2
    ].join('\n'),
  }).initialize();

  it('refs from def#1, def#2, and a usage all return the same complete set', () => {
    const fromUsage = refsOf(ws, 2, 6);  // $pw on line 2
    const fromDef1 = refsOf(ws, 1, 8);   // set -Ux pw  (def #1)
    const fromDef2 = refsOf(ws, 3, 8);   // set -Ux pw  (def #2)

    // every read (0,2,4) must appear regardless of which occurrence is queried
    for (const set of [fromUsage, fromDef1, fromDef2]) {
      expect(set.has('0:6')).toBe(true); // pre-def read included (the bug: was dropped from def#2)
      expect(set.has('2:6')).toBe(true);
      expect(set.has('4:6')).toBe(true);
    }
    // position-independence: identical sets no matter where you click
    expect([...fromDef2].sort()).toEqual([...fromUsage].sort());
    expect([...fromDef1].sort()).toEqual([...fromUsage].sort());
  });
});
