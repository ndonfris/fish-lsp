import { runSetupItems, SetupItem, SetupItemsFromCommandConfig } from '../src/utils/completion/startup-config';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { setLogger } from './helpers';
import { StaticItems } from '../src/utils/completion/static-items';
import { execCmd } from '../src/utils/exec';
import { ConfigSchema } from '../src/config';
import { FishCompletionItemKind } from '../src/utils/completion/types';

/**
 * NOTE: since the test suite is dependent on the machine's shell environment, we need to
 *       account for the possibility of certain commands specifically not being used at all by the user,
 *       while keeping the test suite's confirmation that the command will work if it is used.
 */
namespace AllowedEmptyCommands {
  const allowedEmptyCommands = [
    { kind: FishCompletionItemKind.ALIAS, command: 'alias | count' },
    { kind: FishCompletionItemKind.ABBR, command: 'abbr --show | count' },
  ];

  type AllowedEmptyCommandResult = { kind: FishCompletionItemKind; command: string; count: number; };
  export const items: AllowedEmptyCommandResult[] = [];

  export async function setup(): Promise<AllowedEmptyCommandResult[]> {
    const results: AllowedEmptyCommandResult[] = [];
    for (const { kind, command } of allowedEmptyCommands) {
      const output = await execCmd(command, { interactiveMode: true });
      const count = parseInt(output.join('') ?? '0', 10);
      results.push({ kind, command, count });
    }
    return results;
  }

  export function hasKind(kind: FishCompletionItemKind): boolean {
    const item = items.find(item => item.kind === kind);
    return item ? item.count === 0 : false;
  }

  export function getCountForKind(kind: FishCompletionItemKind): number {
    return items.find(item => item.kind === kind)?.count || 0;
  }
}

/**
 * Utility for performance testing of SetupItems Initialization
 */
export type SetupResult = SetupItem & {
  results: string[];
};

export async function simpleParrallelTestSetupItemsInitializer(
  items: SetupItem[] = SetupItemsFromCommandConfig,
): Promise<SetupResult[]> {
  const settled = await Promise.allSettled(
    items.map((item) =>
      execCmd(item.command, { interactiveMode: true }).then((results) => ({
        ...item,
        results,
      })),
    ),
  );

  return settled.map((outcome, i) => ({
    ...items[i]!,
    results: outcome.status === 'fulfilled' ? outcome.value.results : [],
  }));
}

describe('Test completions/startup-config.ts `SetupItem` commands', () => {
  setLogger();

  beforeAll(async () => {
    await AllowedEmptyCommands.setup();
  });

  describe('test different StartupItem initialization designs', () => {
    // use to see what is actually being passed to fish for each command,
    // and confirm it is being parsed correctly (i.e. no unexpected escaping issues, etc.)
    it.skip('print SetupItems.command string interpretation passed to fish', () => {
      console.log(SetupItemsFromCommandConfig.map(item => {
        return {
          kind: item.fishKind,
          command: item.command,
        };
      }));
      expect(SetupItemsFromCommandConfig.length).toBeGreaterThanOrEqual(5);
    });

    it('parallel SetupItem.command execution', async () => {
      const setupResults = await simpleParrallelTestSetupItemsInitializer();
      // for (const { detail, fishKind, results } of setupResults) {
      //   console.log(`${detail} (${fishKind}): ${results.length} items`);
      // }
      expect(setupResults.length).toBeGreaterThanOrEqual(5);
    });
    it('better SetupItem.command execution', async () => {
      const results = await runSetupItems();
      // console.log(results)
      expect(results.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('CompletionItemMap', () => {
    // setup/teardown CompletionItemMap for all tests in this block
    let completionItemMap: CompletionItemMap;
    beforeAll(async () => {
      completionItemMap = await CompletionItemMap.initialize();
    });
    afterAll(() => {
      completionItemMap = new CompletionItemMap();
    });

    it('should initialize CompletionItemMap without error', () => {
      console.log('-'.repeat(80));
      console.log('CompletionItemMap initialized with the following item counts:');
      completionItemMap.entries().forEach(([kind, items]) => {
        console.log(`- ${kind}: ${items?.length || 0} items`);
        expect(items).toBeDefined();
        // We distinguish between values which a user might not have defined (i.e., no aliases or abbrs)
        // Which 0 items is an acceptable result for
        if (AllowedEmptyCommands.hasKind(kind)) {
          expect(items!.length).toBeGreaterThanOrEqual(AllowedEmptyCommands.getCountForKind(kind));
        } else {
          // Non-empty command kinds should have some items (default items are added to cache)
          expect(items!.length).toBeGreaterThan(0);
        }
      });
      console.log(`Total kinds in CompletionItemMap: ${completionItemMap.allKinds.length}`);
      console.log('-'.repeat(80));
    });

    describe('StaticItems', () => {
      it('confirm all static items were added to CompletionItemMap', () => {
        expect(Object.keys(StaticItems).length).toBeGreaterThan(0);
        Object.keys(StaticItems).forEach(itemType => {
          const items = completionItemMap.allOfKinds(itemType as any);
          expect(items.length).toBeGreaterThan(0);
        });
      });

      it('verbose static item check', () => {
        expect(completionItemMap.allOfKinds('function').length).toBeGreaterThan(0);
        expect(completionItemMap.allOfKinds('command').length).toBeGreaterThan(0);
        expect(completionItemMap.allOfKinds('variable').length).toBeGreaterThan(0);
        expect(completionItemMap.allOfKinds('status').length).toBeGreaterThan(0);
      });

      it('`fish_lsp*` variable check', () => {
        const foundItems = completionItemMap.allOfKinds('variable').filter(item => item.label.startsWith('fish_lsp'));
        expect(foundItems.length).toBeGreaterThan(0);
        for (const key of Object.keys(ConfigSchema.shape)) {
          const match = foundItems.find(item => item.label === key);
          // console.log({
          //   label: match!.label,
          //   documentation: match!.documentation,
          // })
          expect(match).toBeDefined();
          expect(match!.documentation).toBeDefined();
        }
      });
    });
    describe('test CompletionItemMap utility methods', () => {
      it('get()', () => {
        expect(completionItemMap.get('function')).toBeDefined();
        expect(completionItemMap.get('function')!.length).toBeGreaterThan(0);
        expect(completionItemMap.get('command')).toBeDefined();
        expect(completionItemMap.get('command')!.length).toBeGreaterThan(0);
      });

      it('allKinds()', () => {
        const kinds = completionItemMap.allKinds;
        expect(kinds.length).toBeGreaterThan(0);
        expect(kinds).toContain('function');
        expect(kinds).toContain('command');
        expect(kinds).toContain('variable');
        expect(kinds).toContain('status');
      });

      it('findLabel()', () => {
        // define type for testing multiple items
        type TestItemInput = { label: string; kinds: FishCompletionItemKind[]; };
        type TestItemExpectedOutput = { found: boolean; };
        // input tested on should work in ci enviornment, so the most straightforward way
        // to achieve this is by using static items and config variables, which behave
        // deterministically across machines (since they are defined in code, not user config)
        const testItems: { inputParams: TestItemInput; expectedOutput: TestItemExpectedOutput; }[] = [
          {
            inputParams: { label: 'fish_lsp_fish_path', kinds: [] },
            expectedOutput: { found: true },
          },
          {
            inputParams: { label: 'fish_lsp_fish_path', kinds: ['variable'] },
            expectedOutput: { found: true },
          },
          {
            inputParams: { label: 'fish_add_path', kinds: ['function'] },
            expectedOutput: { found: true },
          },
          {
            inputParams: { label: 'fish_add_path', kinds: ['variable'] },
            expectedOutput: { found: false },
          },
          {
            inputParams: { label: 'non_existent_label', kinds: [] },
            expectedOutput: { found: false },
          },
        ];

        for (const { inputParams, expectedOutput } of testItems) {
          const { label, kinds } = inputParams;
          const foundItem = completionItemMap.findLabel(label, ...kinds);

          if (expectedOutput.found) expect(foundItem).toBeDefined();
          else expect(foundItem).toBeUndefined();
        }
      });
    });

    // TODO: confirm `mkdir` is included in output of `complete --do-complete` command (issue #154)
    describe('TEMPORARY TEST FOR #154 `mkdir` command', () => {
      it('confirm `mkdir` is included in output of `complete --do-complete` command', async () => {
        const output = await runSetupItems(
          SetupItemsFromCommandConfig.find(item => item.fishKind === 'command')
            ? [SetupItemsFromCommandConfig.find(item => item.fishKind === 'command')!]
            : [],
        );
        let foundMkdir = false;
        for (const item of output.flatMap(item => item.results)) {
          if (item.startsWith('mkdir')) {
            foundMkdir = true;
            break;
          }
        }
        output.forEach(item => {
          const formattedResults = item.results.map(line => line.trim().split('\t'));

          const closestResults = formattedResults.filter(([label]) => label?.startsWith('mk')).sort((a, b) => {
            const target = 'mkdir';
            const similarity = (label: string) => {
              let i = 0;
              while (i < label.length && i < target.length && label[i] === target[i]) {
                i++;
              }
              return i;
            };
            return similarity(b[0] ?? '') - similarity(a[0] ?? '') || (a[0] ?? '').localeCompare(b[0] ?? '');
          });

          const mkdirLines = formattedResults.filter(([label]) => label?.startsWith('mkdir')).map(splitLine => splitLine.join('\t'));

          const prettyResult = {
            mkdirFound: foundMkdir,
            mkdirLines,
            totalResults: item.results.length,
            closestResults: closestResults.map((splitLine) => splitLine.join('\t')),
          };

          console.log({
            kind: item.fishKind,
            command: item.command,
            // resultsRaw: item.results,
            resultsFormatted: prettyResult,
            topLevel: item.topLevel,
          });
        });
        console.log('Final check: was \'mkdir\' found in any command output?', foundMkdir);
        console.log('-'.repeat(80));
        expect(foundMkdir).toBe(true);
        expect(output.length).toBeGreaterThan(0);
        expect(output.flatMap(o => o.results).length).toBeGreaterThan(0);
      });
    });

    it('check `mkdir` in cache', () => {
      const mkdirItem = completionItemMap.findLabel('mkdir');
      console.log('Found `mkdir` item in cache:', mkdirItem);
      expect(mkdirItem).toBeDefined();
    });

    it('confirm `mkdir` item in cache has correct kind', () => {
      const mkdirItem = completionItemMap.findLabel('mkdir', 'command');
      // console.log('`mkdir` item details:', mkdirItem);
      expect(mkdirItem).toBeDefined();
    });
  });
});
