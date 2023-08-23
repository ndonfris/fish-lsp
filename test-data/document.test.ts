

import { LspDocument } from '../src/document';
import { resolveLspDocumentForHelperTestFile } from './helpers'
import { initializeParser } from '../src/parser';
import {SyntaxNode} from 'web-tree-sitter';

describe('LspDocument tests', () => {

    it('test an document is created not in ~/.config/fish/functions/ directory', () => {
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish', false);
        expect(doc).not.toBeNull();
        expect(doc.isAutoLoaded()).toBeFalsy();
    })

    it('test an document is created in ~/.config/fish/functions/ directory', () => {
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish');
        expect(doc).not.toBeNull();
        expect(doc.isAutoLoaded()).toBeTruthy();
        expect(doc.uri.endsWith('functions/set_var.fish')).toBeTruthy();
    })


    it('testing ability to parse a document', async () => {
        const parser = await initializeParser()
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish');
        const root: SyntaxNode = parser.parse(doc.getText()).rootNode
        expect(root.children).toHaveLength(2)
        expect(doc.lineCount === 2).toBeTruthy()
    })

})




