

import { setLogger } from './helpers'
import * as JsonObjs from '../src/utils/snippets'




setLogger()
describe('snippets tests', () => {
  it('test 1: commands', async () => {
    const out = JsonObjs.Snippets.commands()
    const keys: string[] = []
    out.forEach((v) => {
      keys.push(v.name)
    })
    // console.log(out.size);
    expect(out.has('if')).toBeTruthy()
    expect(keys.includes('if')).toBeTruthy()
  })

 it('test 2: highlight variables', async () => {
    const out = JsonObjs.Snippets.themeVars()
    const keys: string[] = []
   
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    // console.log('highlights: ', keys.join(', '));
    // console.log();
    expect(keys.find(k => k === 'fish_pager_color_progress')).toBeTruthy()
  }) 

 it('test 3: status numbers', async () => {
    const out = JsonObjs.Snippets.status();
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })

    // console.log('status: ', keys.join(', '));
    // console.log();
    expect(keys.find(f => f === '0')).toBeTruthy()
    expect(keys.find(f => f === '1')).toBeTruthy()
  })

  it('test 4: special vars', async () => {
    const out = JsonObjs.Snippets.specialVars()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    // console.log('special vars: ' ,keys.join(', '));
    // console.log();
    expect(keys.length).toBeGreaterThanOrEqual(50)
  })

  it('test 5: pipes', async () => {
    const out = JsonObjs.Snippets.pipes()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    // console.log('pipes:', keys.join(', '));
    // console.log();
    expect(Array.from(keys).length).toBeGreaterThanOrEqual(10)
  })

  it('test 6: userEnvVars', async () => {
    const out = JsonObjs.Snippets.userEnvVariables()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    // console.log('userEnvVars:', keys.join(', '));
    // console.log();
    expect(Array.from(out.values()).length).toBeGreaterThanOrEqual(5)
  })

  it('test 7: print global export of variable', async () => {
    const result = JsonObjs.printFromSnippetVariables(JsonObjs.Snippets.userEnvVariables())
    expect(result.length).toBeGreaterThanOrEqual(15)
  })
})


