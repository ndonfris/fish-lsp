import { initializeParser } from '../src/parser';
import * as LSP from 'vscode-languageserver'
import Parser, { SyntaxNode} from 'web-tree-sitter';
import * as NodeTypes from '../src/utils/node-types'
import { resolveLspDocumentForHelperTestFile, setLogger } from './helpers'
//import Parser from "web-tree-sitter";
import {getChildNodes, getRange} from '../src/utils/tree-sitter';
import { execInlayHintType, execPrintLsp } from '../src/utils/exec';
import { FishInlayHint, inlayHintsProvider } from '../src/inlay-hints';
import { LspDocument } from '../src/document';
import { Analyzer } from '../src/analyze';

let parser: Parser;
let analyzer: Analyzer
setLogger(
    async () => {
        parser = await initializeParser()
        analyzer = new Analyzer(parser)
    },
    async () => {
    }
)


describe('inlay-hints', () => {
    it('test if execPrintLsp works', async () => {
        const out = await execPrintLsp('printf "%s\\n" "hello world" | string split \\n')
        if (!out) {
            console.log('execPrintLsp failed');
        }
        expect(out).toEqual('hello world')
    })

    it('test that we get all command names', async () => {
        const document: LspDocument = resolveLspDocumentForHelperTestFile('./fish_files/simple/func_a.fish')
        const root = parser.parse(document.getText()).rootNode
        const range = getRange(root)

        //const {document, range, analyzer} = simulateInlayHintsRequest('./fish_files/simple/func_a.fish')
        const result = await inlayHintsProvider(document, range, analyzer);
        //logHints(result)

        expect(result.length).toBeGreaterThanOrEqual(1)
    })
})

//function simulateInlayHintsRequest(filepath: string) {
//    const doc: LspDocument = resolveLspDocumentForHelperTestFile(filepath)
//    const root = parser.parse(doc.getText()).rootNode
//    const range = getRange(root)
//
//    return {
//        document: doc,
//        range: range,
//        analyzer: analyzer,
//    }
//}

function logHints(hints: FishInlayHint[]){
    hints.forEach((hint: FishInlayHint) => {
        console.log(hint);
    })
}
