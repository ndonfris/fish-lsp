import fs, {readFile} from 'fs';
import FastGlob from 'fast-glob';
import {promises} from 'fs';
import {homedir, version} from 'os';
import {resolve} from 'path';
import {TextDocument} from 'vscode-languageserver-textdocument';
//import {globby} from 'globby'



interface TextDocumentPromiseParams {
    /**
     * The text document's uri.
     */
    uri: string,
    /*
     * all documents will be fish files
     */
    languageId: string;
    /**
     * The version number of this document (it will increase after each
     * change, including undo/redo).
     */
    version: number;
    /**
     * The content of the opened text document.
     */
    text: Promise<string>;
}

function getTextDocumentPromiseParams(uri: string): TextDocumentPromiseParams {
    return {
        uri,
        languageId: 'fish',
        version: 0,
        text: promises.readFile(uri, 'utf8')
    }
}


export async function getFishFilesFromStandardLocations() {

    const paths = [`${homedir()}/.config/fish`, "/usr/share/fish"];
    const allFiles: string[] = [];

    paths.forEach((path) => {
        const files = FastGlob.sync("**.fish", {
            absolute: true,
            dot: true,
            globstar: true,
            deep: 5,
            cwd: path,
        });
        allFiles.push(...files);
    });

    // now allFiles contains every fish file that could be used in the workspace
    return await Promise.all(
        allFiles.map(async file => {
            const contents = await promises.readFile(file, 'utf8')
            return TextDocument.create(file, 'fish', 0, contents || "")
        })
    )
}

// $HOME/repos/fish-lang-server/src/utils/location.ts
export async function getGlobalIndex(files: string[]) {
    return await Promise.all(
        files.map(async file => {
            const contents = await promises.readFile(file, 'utf8')
            return TextDocument.create(file, 'fish', 0, contents || "")
        })
    )


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
        console.log(t.at(0))
        expect(1).toBeGreaterThan(0)
    })
})

