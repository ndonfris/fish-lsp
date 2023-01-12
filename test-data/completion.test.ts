
import {execCommandDocs, execEscapedCommand} from '../src/utils/exec'
//import { buildGlobalAbbrs, buildGlobalAlaises, buildGlobalBuiltins, buildGlobalCommands, Completion } from '../src/completion'
//import {getDocument, parseFile} from './helpers';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem, Position, Range} from 'vscode-languageserver';
import { BUILT_INS, createCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';



describe('complete simple tests', () => {
    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });

    it('complete BUILT_INS ', async () => {
        for (const cmp of BUILT_INS) {
            console.log(cmp.label);
        }
        console.log();
        console.log();
    })

    it('complete defaults ', async () => {
        const emptyPosition : Position = {line: 0, character: 0};
        const cmps = createCompletionList([...BUILT_INS, ...BUILT_INS], emptyPosition, 0)
        const str = await execCommandDocs('if');
        console.log(str);
    })

})
