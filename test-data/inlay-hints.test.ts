import { initializeParser } from '../src/parser';
import * as LSP from 'vscode-languageserver'
import Parser, { SyntaxNode} from 'web-tree-sitter';
import * as NodeTypes from '../src/utils/node-types'
import { resolveLspDocumentForHelperTestFile, setLogger } from './helpers'
//import Parser from "web-tree-sitter";
import {getChildNodes, getRange} from '../src/utils/tree-sitter';
import { execInlayHintType } from '../src/utils/exec';
import { FishInlayHint, FishInlayHintsProvider } from '../src/inlay-hints';
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
    it('test that we get all command names', async () => {
        const doc: LspDocument = resolveLspDocumentForHelperTestFile('./fish_files/simple/func_a.fish')
        const root = parser.parse(doc.getText()).rootNode
        const range = getRange(root)

        const result = await FishInlayHintsProvider.provideInlayHints(doc, range, analyzer);

        result.forEach((hint: FishInlayHint) => {
            console.log(JSON.stringify(hint, null, 2));
        })

        //const root = parser.parse(doc.getText()).rootNode;
        //const children = getChildNodes(root).filter(node => NodeTypes.isCommandName(node))
        //const hints : LSP.InlayHint[] = []
        //for (const child of children) {
        //    const text = await execInlayHintType(child.text)
        //    const hint = LSP.InlayHint.create({line: child.startPosition.row, character: child.startPosition.column}, text, LSP.InlayHintKind.Type)
        //    hint.paddingLeft = true;
        //    hints.push(hint)
        //}
        //hints.forEach(hint => {
        //    console.log(JSON.stringify({hint: hint}, null, 2));
        //})
    })

})