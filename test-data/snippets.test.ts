

import { setLogger } from './helpers'
import * as JsonObjs from '../src/utils/snippets'




setLogger()
describe('snippets tests', () => {
  it('test 1: commands', async () => {
    JsonObjs.commands()
    console.log();
  })

 it('test 2: highlight variables', async () => {
    const out = JsonObjs.highlightVariables()
    const keys: string[] = []
   
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    console.log('highlights: ', keys.join(', '));
    console.log();
  }) 

 it('test 3: status numbers', async () => {
    const out = JsonObjs.statusNumbers()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })

    console.log('status: ', keys.join(', '));
    console.log();
  })

  it('test 4: special vars', async () => {
    const out = JsonObjs.specialVars()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    console.log('special vars: ' ,keys.join(', '));
    console.log();
  })

  it('test 5: pipes', async () => {
    const out = JsonObjs.pipeVars()
    const keys: string[] = []
    out.forEach(k => {
      keys.push(k.name)
      // console.log(k.name, k.description);
    })
    console.log('pipes:', keys.join(', '));
    console.log();
  })

})


