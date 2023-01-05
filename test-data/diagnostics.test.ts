import os from 'os'
import {  getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName, resolveAbsPath } from './helpers';
import {Point, SyntaxNode, Tree} from 'web-tree-sitter';
import {findEnclosingVariableScope, isBlock, isCommand, isCommandName, isEnd, isError, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariable, isVariableDefinition} from '../src/utils/node-types';
import {findEnclosingScope, findFirstParent, getNodeAtRange, getRange, nodesGen} from '../src/utils/tree-sitter';
import { Range, DocumentSymbol, Location, Diagnostic } from 'vscode-languageserver'
import {getChildNodes, positionToPoint} from '../src/utils/tree-sitter';
import {initializeParser} from '../src/parser';
import * as colors from 'colors'
import {toSymbolKind} from '../src/symbols';
import {containsRange, getReferences, getMostRecentReference} from '../src/workspace-symbol';
import { collectCommandString, getHoverForFlag, } from '../src/hover'
import {pathToUri} from '../src/utils/translation';
import { incorrectFunctionName } from '../src/diagnostics/incorrectFunctionName';
import { syntaxError } from '../src/diagnostics/syntaxError';
import { getDiagnostics } from '../src/diagnostics/validate';
import {resolve} from 'path';

let SHOULD_LOG = true
const jestConsole = console;
jest.setTimeout(25000)

beforeEach(() => {
    global.console = require('console');
});
afterEach(() => {
    global.console = jestConsole;
});


function collectScope(root: SyntaxNode, scopes: SyntaxNode[]) {
    const errors = getChildNodes(root).filter(isError)
    let i = 0
    for (const node of errors) {
        const ends = getChildNodes(node).filter(isEnd).slice(0, -1)
        for (const end of ends) {
            if (i % 2 === 0)  {
                console.log(end?.parent!.text.bgRed);
            } else {
                console.log(end?.parent!.text.bgYellow);
            }
            i++
        }
    }


}



describe('test diagnostics', () => {
    it( 'test bad function name', async () => {
        const test_input_path = resolve(`${os.homedir()}/.config/fish/functions/test-fish-lsp.fish`);
        const test_input = await resolveAbsPath(test_input_path)
        const parser = await initializeParser();
        const uri = pathToUri(test_input_path, undefined )
        if (SHOULD_LOG) console.log(uri.bgWhite.red);
        const root = parser.parse(test_input.join('\n')).rootNode;
        if (SHOULD_LOG) console.log(root.text.bgWhite.red);
        //const diagnostics = getDiagnostics(uri, root);
        //if (SHOULD_LOG) {
        //    diagnostics.forEach(d => {
        //        console.log(getNodeAtRange(root, d.range)?.text.bgBlack.magenta);
        //    })
        //}
        collectScope(root, []);
    })
})
