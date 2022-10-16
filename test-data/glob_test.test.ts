

import {promises, readdirSync, readFile, readFileSync} from 'fs';
import {glob} from 'glob';
import FastGlob from 'fast-glob'
import {homedir} from 'os';
import path, { resolve, sep } from 'path'
import {TextDocument} from 'vscode-languageserver-textdocument';
//import {globby} from 'globby'
import promisify from 'util';






// $HOME/repos/fish-lang-server/src/utils/location.ts
export async function getGlobalIndex(files: string[]) : Promise<TextDocument> {
    return Promise.all(
        files.map(async file => TextDocument.create(file, 'fish', 0, await promises.readFile(file, 'utf8')))
    ).then()


    // globby -> https://github.com/sindresorhus/globby#readme
    // patterns ->  https://github.com/sindresorhus/multimatch/blob/main/test/test.js
    // fast-glob -> https://github.com/mrmlnc/fast-glob#how-to-use-unc-path
    // note: fast-glob is used under the hood, and the second param of options 
    //       is from @types/fast-glob

    //return await globby([homePattern, '/usr/share/fish/**.fish'], {onlyFiles: true, absolute: true})
}


describe("glob_test output", () => {
    jest.setTimeout(7000)

    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });

    it('testing empty', async () => {
        const d = resolve(__dirname)
        console.log(d)
        expect(1).toBeGreaterThan(0)
    })


    it('testing getGlobalIndex with globby', async () => {
        //const files = await getGlobalIndex(resolve(__dirname))
        //for (const file in files) {
            //console.log('file: ' + file);
        //}
        //let pattern = resolve(homedir(), '.config', 'fish', "**.fish")
        let paths = [`${homedir()}/.config/fish`, '/usr/share/fish']
        const allFiles: string[] = []
        paths.forEach(path => {    
            let files = FastGlob.sync('**.fish', {absolute: true, dot: true, globstar: true, deep: 5 , cwd: path});
            allFiles.push(...files)
        })
        console.log(allFiles)
        const t = await getGlobalIndex(allFiles)
        expect(1).toBeGreaterThan(0)
    })
})

