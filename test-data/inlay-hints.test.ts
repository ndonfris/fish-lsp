import { initializeParser } from '../src/parser';
import * as LSP from 'vscode-languageserver'
import { SyntaxNode} from 'web-tree-sitter';
import * as NodeTypes from '../src/utils/node-types'
import { resolveLspDocumentForHelperTestFile } from './helpers'
import Parser from "web-tree-sitter";
import {getChildNodes} from '../src/utils/tree-sitter';
import { execInlayHintType } from '../src/utils/exec';

let parser: Parser;
let SHOULD_LOG = false

const jestConsole = console;

beforeEach(async () => {
    parser = await initializeParser();
    global.console = require('console');
})

afterEach(() => {
    global.console = jestConsole;
    SHOULD_LOG = false
});

describe('inlay-hints', () => {
    it('test that we get all command names', async () => {
        const doc = resolveLspDocumentForHelperTestFile('./fish_files/simple/func_a.fish')
        const root = parser.parse(doc.getText()).rootNode;
        const children = getChildNodes(root).filter(node => NodeTypes.isCommandName(node))
        const hints : LSP.InlayHint[] = []
        for (const child of children) {
            const text = await execInlayHintType(child.text)
            const hint = LSP.InlayHint.create({line: child.startPosition.row, character: child.startPosition.column}, text, LSP.InlayHintKind.Type)
            hint.paddingLeft = true;
            hints.push(hint)
        }
        hints.forEach(hint => {
            console.log(JSON.stringify({hint: hint}, null, 2));
        })
    })

})



