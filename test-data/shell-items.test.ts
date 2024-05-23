import { spawnSyncRawShellOutput } from '../src/utils/startup-shell-items';
import { assert } from 'chai'
import { execCmd } from '../src/utils/exec';
import { setLogger, LogOpts } from './helpers'
import { ShellItems } from '../src/utils/shell-items'

setLogger(
    async () => {},
    async () => {},
    LogOpts.clean
);

describe('default-completion-item-provider', () => {
     
     it('timing individual shell calls', async () => {
        console.time('sync all calls')
        console.time('abbr')
        let output = spawnSyncRawShellOutput(`abbr | string split ' -- ' -f2 | string unescape`)
        console.timeEnd('abbr')
     
        console.time('functions')
        output = spawnSyncRawShellOutput(`functions --names | string split -n '\\n'`)
        console.timeEnd('functions')
     
        console.time('vars')
        output = spawnSyncRawShellOutput(`set -n`)
        console.timeEnd('vars')
     
        console.time('handlers')
        output = spawnSyncRawShellOutput(`functions --handlers | string match -vr '^Event \\w+' | string split -n '\\n'`)
        console.timeEnd('handlers')
     
     
        console.time('builtin')
        output = spawnSyncRawShellOutput(`builtin -n`)
        console.timeEnd('builtin')
     
        console.timeEnd('sync all calls')
     }, 10000)

    it('timing combined shell calls', async () => {
        console.time('async all calls')
        const items = new ShellItems()
        await items.init()
        console.timeEnd('async all calls')
    })

    it('look up strings', async () => {
        const items = new ShellItems()
        await items.init()
        assert.equal(items.getItemType('echo'), 'builtin')
    })

    it('item lookup (variables)', async () => {
        const items = new ShellItems()
        await items.init()
        assert.equal(items.hasItem('echo', ['builtin', 'function']), true)
        assert.equal(items.hasItem('printf', ['builtin', 'function']), true)
        assert.equal(items.getItemType('printf'), 'builtin')
        assert.equal(items.getItemType('CMD_DURATION'), items.getItemType('$CMD_DURATION'))
        assert.deepEqual([
            items.hasItem('$CMD_DURATION', ['variable']),
            items.hasItem('CMD_DURATION', ['variable']),
            items.hasItem('$CMD_DURATION'),
        ], [true, true, true])
    })
 })