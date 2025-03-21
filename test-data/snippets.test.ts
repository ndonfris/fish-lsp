import { setLogger } from './helpers';
// import * as JsonObjs from '../src/utils/snippets'
import { EnvVariableJson, ExtendedJson, fishLspObjs, fromCliOutputToString, fromCliToMarkdownString, getPrebuiltDocUrlByName, PrebuiltDocumentationMap } from '../src/utils/snippets';
import { generateJsonSchemaShellScript, showJsonSchemaShellScript } from '../src/config';
let prebuiltDocs = PrebuiltDocumentationMap;

prebuiltDocs = PrebuiltDocumentationMap;
describe('snippets tests', () => {
  setLogger();

  describe('fish_lsp_* env variables', () => {
    it('should have fish_lsp_logfile', () => {
      const misses: ExtendedJson[] = [];
      for (const obj of fishLspObjs) {
        if (EnvVariableJson.is(obj)) {
          expect(EnvVariableJson.is(obj)).toBeTruthy();
        } else {
          misses.push(obj);
        }
      }
      expect(misses).toHaveLength(0);
    });

    it('print cli comment string', () => {
      for (const obj of fishLspObjs) {
        const cli = EnvVariableJson.asCliObject(obj);
        const output = fromCliOutputToString(cli);
        if (obj.name === 'fish_lsp_enabled_handlers') {
          expect(output.split('\n').at(0)!).toEqual('# $fish_lsp_enabled_handlers <ARRAY>');
        } else if (obj.name === 'fish_lsp_logfile') {
          expect(output.split('\n').at(0)!).toEqual('# $fish_lsp_logfile <STRING>');
        } else if (obj.name === 'fish_lsp_log_file') {
          expect(output.split('\n').at(0)!).toEqual('# $fish_lsp_log_file <STRING>');
        }
      }
    });

    it('get all env variables', () => {
      prebuiltDocs.getByType('variable', 'fishlsp').forEach((v) => {
        expect(EnvVariableJson.is(v)).toBeTruthy();
      });
    });

    it('get all cli output for `env`', () => {
      prebuiltDocs.getByType('variable', 'fishlsp').forEach((v) => {
        if (EnvVariableJson.is(v)) {
          const cli = EnvVariableJson.asCliObject(v);
          const output = fromCliOutputToString(cli);
          expect(output.split('\n').length).toBeGreaterThanOrEqual(4);
        }
      });
    });

    it('wrapped `env`', () => {
      for (const obj of fishLspObjs) {
        const cli = EnvVariableJson.asCliObject(obj);
        const output = fromCliOutputToString(cli, { includeDefaultValue: true, includeType: true, includeOptions: true, wrap: true });
        console.log(output);
        console.log();
      }
    });

    it('env documentation', () => {
      for (const obj of fishLspObjs) {
        const cli = EnvVariableJson.asCliObject(obj);
        console.log(fromCliToMarkdownString(cli));
        console.log();
      }
    });

    it('build in cli', () => {
      generateJsonSchemaShellScript(false, true, true, false, true);
    });

    it('cli show', () => {
      showJsonSchemaShellScript(false, true, true, false, true);
    });
  });

  //  it('test 1: commands', async () => {
  //    const out = JsonObjs.Snippets.commands()
  //    const keys: string[] = []
  //    out.forEach((v) => {
  //      keys.push(v.name)
  //    })
  //    // console.log(out.size);
  //    expect(out.has('if')).toBeTruthy()
  //    expect(keys.includes('if')).toBeTruthy()
  //  })
  //
  // it('test 2: highlight variables', async () => {
  //    const out = JsonObjs.Snippets.themeVars()
  //    const keys: string[] = []
  //
  //    out.forEach(k => {
  //      keys.push(k.name)
  //      // console.log(k.name, k.description);
  //    })
  //    // console.log('highlights: ', keys.join(', '));
  //    // console.log();
  //    expect(keys.find(k => k === 'fish_pager_color_progress')).toBeTruthy()
  //  })
  //
  // it('test 3: status numbers', async () => {
  //    const out = JsonObjs.Snippets.status();
  //    const keys: string[] = []
  //    out.forEach(k => {
  //      keys.push(k.name)
  //      // console.log(k.name, k.description);
  //    })
  //
  //    // console.log('status: ', keys.join(', '));
  //    // console.log();
  //    expect(keys.find(f => f === '0')).toBeTruthy()
  //    expect(keys.find(f => f === '1')).toBeTruthy()
  //  })
  //
  //  it('test 4: special vars', async () => {
  //    const out = JsonObjs.Snippets.specialVars()
  //    const keys: string[] = []
  //    out.forEach(k => {
  //      keys.push(k.name)
  //      // console.log(k.name, k.description);
  //    })
  //    // console.log('special vars: ' ,keys.join(', '));
  //    // console.log();
  //    expect(keys.length).toBeGreaterThanOrEqual(50)
  //  })
  //
  //  it('test 5: pipes', async () => {
  //    const out = JsonObjs.Snippets.pipes()
  //    const keys: string[] = []
  //    out.forEach(k => {
  //      keys.push(k.name)
  //      // console.log(k.name, k.description);
  //    })
  //    // console.log('pipes:', keys.join(', '));
  //    // console.log();
  //    expect(Array.from(keys).length).toBeGreaterThanOrEqual(10)
  //  })
  //
  //  it('test 6: userEnvVars', async () => {
  //    const out = JsonObjs.Snippets.fishlspEnvVariables()
  //    const keys: string[] = []
  //    out.forEach(k => {
  //      keys.push(k.name)
  //      // console.log(k.name, k.description);
  //    })
  //    // console.log('userEnvVars:', keys.join(', '));
  //    // console.log();
  //    expect(Array.from(out.values()).length).toBeGreaterThanOrEqual(5)
  //  })
  //
  //  it('test 7: print global export of variable', async () => {
  //    const result = JsonObjs.printFromSnippetVariables(JsonObjs.Snippets.fishlspEnvVariables())
  //    expect(result.length).toBeGreaterThanOrEqual(15)
  //  })

  it('test 1: all prebuilt types', async () => {
    const commands = prebuiltDocs.getByType('command');
    const pipes = prebuiltDocs.getByType('pipe');
    const stats = prebuiltDocs.getByType('status');
    const vars = prebuiltDocs.getByType('variable');
    // console.log('amount seen', {
    //   commands: commands.length,
    //   pipes: pipes.length,
    //   stats: stats.length,
    //   vars: vars.length
    // });
    expect(commands.length).toBeGreaterThan(100);
    expect(pipes.length).toBeGreaterThanOrEqual(13);
    expect(stats.length).toBeGreaterThanOrEqual(9);
    expect(vars.length).toBeGreaterThanOrEqual(90);
  });

  it('test 2: matchingNames for theme variables', async () => {
    const color = prebuiltDocs.findMatchingNames('fish_color');
    const pager = prebuiltDocs.findMatchingNames('fish_pager');
    expect(color.length).toBeGreaterThan(20);
    expect(pager.length).toBeGreaterThan(10);
  });

  it('test 3: check variable names with leading "$"', () => {
    expect(prebuiltDocs.getByName('$PATH')).toBeTruthy();
    expect(prebuiltDocs.getByName('$fish_pager_color_background')).toBeTruthy();
  });

  it('test 4: check pipes', async () => {
    expect(prebuiltDocs.getByName('&>')).toBeTruthy();
    expect(prebuiltDocs.getByName('>')).toBeTruthy();
    expect(prebuiltDocs.getByName('>>')).toBeTruthy();
    expect(prebuiltDocs.getByName('<')).toBeTruthy();
    expect(prebuiltDocs.getByName('asdkfdsfdf').length).toBeFalsy();
  });

  it('test 5: check status numbers', async () => {
    expect(prebuiltDocs.getByName('0')).toBeTruthy();
    expect(prebuiltDocs.getByName('1')).toBeTruthy();
    expect(prebuiltDocs.getByName('121')).toBeTruthy();
    expect(prebuiltDocs.getByName('123')).toBeTruthy();
    expect(prebuiltDocs.getByName('124')).toBeTruthy();
    expect(prebuiltDocs.getByName('125')).toBeTruthy();
    expect(prebuiltDocs.getByName('126')).toBeTruthy();
    expect(prebuiltDocs.getByName('127')).toBeTruthy();
    expect(prebuiltDocs.getByName('128')).toBeTruthy();
  });

  it('test 6: check links/urls', async () => {
    // expect(getPrebuiltDocUrl(prebuiltDocs.getByName('0'))).toBeTruthy()
    // expect(getPrebuiltDocUrl(prebuiltDocs.getByName('fish_greeting'))).toEqual('https://fishshell.com/docs/current/cmds/fish_greeting.html')
    // console.log(getPrebuiltDocUrl(prebuiltDocs.getByName('abbr')))
    // console.log(prebuiltDocs.getByName('fish_greeting'))
    expect(getPrebuiltDocUrlByName('fish_greeting').split('\n').length).toBeGreaterThan(1);
    // console.log(prebuiltDocs.findMatchingNames('fish_greeting'));
    // prebuiltDocs.getByName('fish_greeting')
  });
});
