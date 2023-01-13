import {  getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName, resolveRelPath } from './helpers';
import {Point, SyntaxNode, Tree} from 'web-tree-sitter';
import {findEnclosingVariableScope, isSwitchStatement, isCaseClause, isCommand, isCommandName, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariable, isVariableDefinition} from '../src/utils/node-types';
import {findEnclosingScope, findFirstParent, getNodeAtRange, getRange, nodesGen} from '../src/utils/tree-sitter';
import { Range, DocumentSymbol, Location } from 'vscode-languageserver'
import {getChildNodes, positionToPoint} from '../src/utils/tree-sitter';
import {initializeParser} from '../src/parser';
import * as colors from 'colors'
import {toSymbolKind} from '../src/symbols';
import {containsRange, getReferences, getMostRecentReference} from '../src/workspace-symbol';
import { collectCommandString, getHoverForFlag, } from '../src/hover'
import { resolve } from 'path'
import { FishFormattingDefaults } from '../src/configManager';
import { applyFormatterSettings } from '../src/formatting';
import {execFormatter} from '../src/utils/exec';
//import

let SHOULD_LOG = true
const jestConsole = console;
jest.setTimeout(25000)

beforeEach(() => {
    global.console = require('console');
});
afterEach(() => {
    global.console = jestConsole;
});



const options = FishFormattingDefaults;

describe('formatting tests', () => {
    it('formatting switch case', async () => {
        const test_input_path = resolve(__dirname, 'fish_files/switch_case_test_1.fish');
        const test_input = resolveRelPath('test-data', 'fish_files/switch_case_test_1.fish');
        const parser = await initializeParser();
        if (SHOULD_LOG) console.log(test_input_path);
        const rootNodes = await getRootNodesFromTexts(test_input)
        const rootNode = rootNodes[0]
        if(SHOULD_LOG) console.log(rootNode.text)
        let formattedText = await execFormatter(test_input_path)
        if(SHOULD_LOG) console.log(formattedText)
        const root = parser.parse(formattedText).rootNode
        const result = applyFormatterSettings(root, options)
        //const switches = getChildNodes(root).filter(n => isSwitchStatement(n))
        //for (const scope of switches) {
            //const range = getRange(scope)
            //const startLine = range.start.line + 1
            //const endLine = range.end.line - 1
            //const lines = formattedText.split('\n')
            //formattedText = [
                //...lines.slice(0, startLine),
                //...lines.slice(startLine, endLine).map(line => line.replace(/ {4}/, '')),
                //...lines.slice(endLine)
            //].join('\n')
        //}
        console.log(result)


        expect(true).toBe(true);
    })

})





