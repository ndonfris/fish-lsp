import {
    //resolveRelPath,
    resolveAbsPath,
    getRootNode,
    readShareDir,
    positionStr,
    readFishDir
} from './helpers'

import { TextDocument } from 'vscode-languageserver-textdocument';
import { LspDocuments } from '../src/files'
import  { getAllFishLocations, FISH_LOCATIONS } from '../src/utils/locations'



describe("analyzer output", () => {
    jest.setTimeout(7000)

    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });

    it('testing nodes if FISH_LOCATIONS works', async () => {
        const files = await readShareDir()
        const docs = new LspDocuments();
        if (files.length) {
            files.forEach(async file => {
                await docs.newDocument(file)
                const logtxt = docs.get(file)?.uri || "";
                const deps = docs.get(file)?.getMatchingDep() || "";
                expect(logtxt).toMatch(file)
                //console.log(`file: ${logtxt}`)
                console.log(`dep: ${deps}`)
                //console.log()
            })
        } else {
            fail('readShareDir() failed in analyzer.test.ts')
        }
    })

    it('testing nodes if FISH_LOCATIONS works', async () => {
        const files = await getAllFishLocations()
        if (!files) {
            fail('getAllFishLocations() failed in text-documents.test.ts')
        }
        const docs = new LspDocuments();
        files.forEach(async file => {
            await docs.newDocument(file)
            const logtxt = docs.get(file)?.uri || "";
            //const deps = docs.get(file) || "";
            //expect(logtxt).toMatch(file)
        })
    })
})

