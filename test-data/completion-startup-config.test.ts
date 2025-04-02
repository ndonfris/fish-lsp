import { SetupItemsFromCommandConfig } from '../src/utils/completion/startup-config';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { setLogger } from './helpers';
import { spawn } from 'child_process';
import { StaticItems } from '../src/utils/completion/static-items';
import { execAsyncF, execCompleteLine } from '../src/utils/exec';

/**
 * Executes a command in a Fish subshell without inheriting autoloaded behaviors.
 * @param command - The command to be executed.
 * @returns A promise that resolves with the command output or rejects with an error.
 */
async function execPrivateFishCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    /**
     * spawn `fish --no-config`, don't throw stderr and see
     * how SetupItemsFromCommand & CompletionItemMap would handle it
     */
    const child = spawn('fish', ['--no-config', '-c', command], {
      stdio: 'pipe',
      env: {
        PATH: process.env.PATH,
      },
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        console.log('error:' + command);
        resolve('error:' + output);
        // reject(new Error(`Command failed with exit code ${code}: ${errorOutput}`));
      }
    });

    child.on('error', (err) => {
      resolve('error: ' + output);
    });
  });
}

let setupItemsArr: typeof SetupItemsFromCommandConfig;
let completionItemMap: CompletionItemMap;

setLogger(
  async () => {
    setupItemsArr = SetupItemsFromCommandConfig;
    completionItemMap = await CompletionItemMap.initialize();
  },
  async () => {
    setupItemsArr = [];
    completionItemMap = new CompletionItemMap();
  },
);

describe('utils/completion/startup-config.ts test', () => {
  it('read all SetupItemsFromCommandConfig', async () => {
    /**
     * create callbacks map
     */
    const callbacks = setupItemsArr.map(c => {
      return {
        item: c,
        func: execPrivateFishCommand(c.command),
      };
    });

    /**
     * Resolve callback promises
     */
    const res = await Promise.all(callbacks.map(async cb => {
      const cmds = (await cb.func).split('\n').filter(f => f.trim() !== '');
      return {
        name: cb.item.fishKind,
        cmds: cmds,
        cmdsLen: cmds.length,
      };
    }));

    /**
     * Check result
     */
    res.forEach(r => {
      if (r.cmdsLen === 0) {
        // console.log('empty');
        expect(['abbr', 'alias', 'event'].includes(r.name)).toBeTruthy();
      } else {
        // console.log("not empty");
        expect(['builtin', 'function', 'command', 'variable'].includes(r.name)).toBeTruthy();
      }
    });

    expect(res.length).toBe(7);
  });

  /**
   * Probably should add more tests...
   *
   * They will need to be config agnostic though!
   * (i.e., passes on every machine `fish --no-config`)
   */

  describe('static items', () => {
    it('should have static items', async () => {
      completionItemMap.allOfKinds('function').forEach(item => {
        console.log(item.label, item.kind);
      });
      completionItemMap.allOfKinds('variable').forEach(item => {
        // StaticItems.variable.forEach(item => {
        if (item.label.startsWith('fish_lsp')) {
          console.log(item);
        }
      });
      completionItemMap.allOfKinds('status').forEach(item => {
        console.log(item.label, item.kind);
      });
    });
  });

  describe.only('completion shell', () => {
    it('should complete shell', async () => {
      const shell = await execCompleteLine('fish-lsp --');
      console.log(shell);
    });
  });
});
