import { getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName } from './helpers';
import { SyntaxNode } from 'web-tree-sitter';
import { DocumentSymbol, Location, SymbolInformation, WorkspaceSymbol, Range, SymbolKind } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { getChildNodes, getNodeAtRange, getRange, isNodeWithinRange, nodesGen } from '../src/utils/tree-sitter';
import { isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition, isCommand, isCommandName, findEnclosingVariableScope, isScope } from '../src/utils/node-types'
//import { collectSymbolInformation, FishSymbolMap } from '../src/workspace-symbol'
//import { getDefinitionSymbols } from '../src/symbols'
import {execFindDependency} from '../src/utils/exec';
import {isBuiltin} from '../src/utils/builtins';
//import {DocumentManager} from '../src/document';
import {nodeToDocumentSymbol, nodeToSymbolInformation} from '../src/utils/translation';
import {symbolKindToString, toSymbolKind} from '../src/symbols';
import { containsRange } from '../src/workspace-symbol';

let SHOULD_LOG = false; // toggle to print testcase output



const jestConsole = console;
jest.setTimeout(25000)

beforeEach(() => {
    global.console = require('console');
});
afterEach(() => {
    global.console = jestConsole;
});

/////////////////////////////////////////////////////////////////////////////////////////
// FISH TEXT SIMULATING FILES
/////////////////////////////////////////////////////////////////////////////////////////

// FUNCTIONS 
const testFunctionFile1 = 
`function test_f1 -a arg1 -a arg2
    echo "$arg1"
    echo "$arg2"
end`
const testFunctionFile2 = 
`function test_f2 --argument-names arg1 arg2
    echo "$arg1"
    echo "$arg2"
end`
const testFunctionFile3 = 
`function test_f3 -a arg1 -d 'howdy' -a arg2
    echo "$arg1"
    echo "$arg2"
end`


// READ
const testReadFile1 = 
`printf '%s' line1 line2 line3 line4 | while read -l foo
    echo "This is another line: $foo"
end`
const testReadFile2 = `echo 'a\\ b' | read -l var1 -P "hi" -t var2`
const testReadFile3 = `echo 'a"foo bar"b (command echo wurst)*" "{a,b}' | read -lt -l a b c`


// FOR LOOPS
const testForLoop1 = `for i in (seq 1 10); echo $i; end`
const testForLoop2 = 
`for arg in $argv
    echo $arg
end`


// SET 
const testSetFile1 = `set -l var1 1`
const testSetFile2 = `set -a var1 1 2 3 4`
const testSetFile3 = `set -a var1 $argv`
const testSetFile4 = `set -a var1 (echo $argv)`


/////////////////////////////////////////////////////////////////////////////////////////
// BEGIN TESTS
/////////////////////////////////////////////////////////////////////////////////////////

describe('symbols tests for definitions and renames', () => {
    /**
     * tests for function definition names. See next test for the other type of defenition
     * in these inputs. each input only has one function. Test also checks that parser is working
     * for isFunctionDefinition()
     *
     * fish text: `function test_f1`
     * defenition: `test_f1`
     */
    it('parsing function name syntaxNodes', async () => {
        const testFiles = [testFunctionFile1, testFunctionFile2, testFunctionFile3];
        const rootNodes = await getRootNodesFromTexts(testFunctionFile1, testFunctionFile2, testFunctionFile3)
        printTestName('PARSING FUNCTION NAMES SYNTAXNODES', SHOULD_LOG)
        rootNodes.forEach((rootNode, i) => {
            logTestFileInfo(i.toString(), rootNode, SHOULD_LOG)
            let testNode1 : SyntaxNode | null = null;
            let testNode2 : SyntaxNode | null = null;
            for (const child of getChildNodes(rootNode)) {
                if (isFunctionDefinition(child)) {
                    testNode1 = child.firstNamedChild;
                }
                if (isFunctionDefinitionName(child)) {
                    testNode2 = child;
                }
                if (testNode1 !== null && testNode2 !== null) {
                    expect(testNode1.text).toEqual(testNode2.text);
                    logCompareNodes(SHOULD_LOG, testNode1, testNode2);
                    testNode1 = null;
                    testNode2 = null;
                }
            }
        })
    })

    /**
     * tests variable definitions that are defined from the argument-names switch for
     * a function definition.
     *
     * fish text: `function test_f2 --argument-names arg1 arg2`
     * variable definitions: `arg1` and `arg2`
     */
    it('parsing function argument variable definition syntaxNodes', async () => {
        const testFiles = [testFunctionFile1, testFunctionFile2, testFunctionFile3];
        const rootNodes = await getRootNodesFromTexts(...testFiles)
        printTestName('PARSING FUNCTION ARGUMENT VARIABLE DEFINITION SYNTAXNODES', SHOULD_LOG)
        const testFileArgs = ['arg1', 'arg2']; // all files only have argument names 'arg1' and 'arg2'
        rootNodes.forEach((root, testIndex) => {
            logTestFileInfo(testIndex.toString(), root)
            let argIndex = 0;
            for (const child of getChildNodes(root)) {
                if (!isVariableDefinition(child)) continue
                expect(child.text).toEqual(testFileArgs[argIndex]);
                logVerboseNode(SHOULD_LOG, child);
                argIndex++
            }
        })
    })

    // READ TESTS
    it('parsing read variable definition SyntaxNodes', async () => {
        const rootNodes = await getRootNodesFromTexts(testReadFile1, testReadFile2, testReadFile3)
        printTestName('PARSING READ VARIABLE DEFINITION SYNTAXNODES', SHOULD_LOG)
        // note that the test index correlates to the amount of variables in the file
        // (i.e first file should have 1 variable, second file should have 2 variables, etc.)
        rootNodes.forEach((root, testIndex) => {
            logTestFileInfo(testIndex.toString(), root)
            const vars: SyntaxNode[] = []; 
            for (const child of getChildNodes(root)) {                                   
                if (!isVariableDefinition(child)) continue;
                vars.push(child);                                                
            }                                                                            
            expect(vars.length == testIndex + 1).toBe(true);
        })
    })

    //// FOR LOOP TESTS
    it('parsing for loop variable definition SyntaxNodes', async () => {
        const testFiles = [testForLoop1, testForLoop2];
        const rootNodes = await getRootNodesFromTexts(...testFiles)
        printTestName('PARSING FOR LOOP VARIABLE DEFINITION SYNTAXNODES', SHOULD_LOG)
        rootNodes.forEach((root, i) => {
            logTestFileInfo(i.toString(), root)
            const vars: SyntaxNode[] = []; 
            for (const child of getChildNodes(root)) {                                   
                if (!isVariableDefinition(child)) continue;
                vars.push(child);                                                
            }                                                                            
            expect(vars.length == 1).toBe(true);
        })
    })

    // SET TESTS
    it('parsing set variable definitions SyntaxNodes', async () => {                 
        const testFiles = [testSetFile1, testSetFile2, testSetFile3, testSetFile4];
        const rootNodes = await getRootNodesFromTexts(...testFiles)                      
        printTestName('PARSING SET VARIABLE DEFINITIONS SYNTAXNODES', SHOULD_LOG)    
        rootNodes.forEach((root, i) => {                                                 
            logTestFileInfo(i.toString(), root)                                          
            const vars: SyntaxNode[] = []; 
            for (const child of getChildNodes(root)) {                                   
                if (!isVariableDefinition(child)) continue;
                vars.push(child);                                                
            }                                                                            
            logNode(SHOULD_LOG, vars[0])
            expect(vars.length == 1).toBe(true);                                           
        })                                                                               
    })                                                                                   

    it('parsing symbol enclosing scope', async () => {
        const rootNodes = await getRootNodesFromTexts(testEnclosingScopeFile1)
        printTestName('PARSING SYMBOL ENCLOSING SCOPE', SHOULD_LOG)    
        rootNodes.forEach((root, i) => {                                                 
            logTestFileInfo(i.toString(), root)                                          
            const vars: SyntaxNode[] = []; 
            for (const child of getChildNodes(root)) {                                   
                if (!isVariableDefinition(child)) continue;
                const parentScope = findEnclosingVariableScope(child)
                if (SHOULD_LOG) {
                    printDebugSeperator()
                    console.log(`node: ${child.text}`)
                    console.log(`parent type: ${parentScope?.type}\nparentScope:\n${parentScope?.text}`)
                }
                vars.push(child);                                                
            }                                                                            
            expect(vars.length == 4).toBe(true);                                           
        })                                                                               

    })
})

const testEnclosingScopeFile1 = 
`function test_f1
    set var0 0
    set -l var1 1
    set --local var2 2
    set --global var3 3
end
echo "should not show for var1 and var2"
`


const testCommandFile1 = 
`echo "hello world"
__fish_whatis
__fish_whatis_current_token
__fish_man_page
cat file.txt
function test_f1 -a var1 -a var2 -a var3
    echo "hello world"
    for i in (seq 1 10)
        echo "$i"
    end
end
test_f1
test_f1
fzf
fzf_mine
fzf_mini
__all_helper
__fish_complete
man
__fish_whatis
__fish_whatis_current_token
set gvar 1
`

const testCompleteFile2 = `
function test-fish-lsp --argument-names file --description "Check a file for syntax errors"
    echo "$file"
    lso
    fzf-local-node_modules
    __test_small
end


## this is a comment
function __test_small 
    if string match --regex '^(\w{10}).fish' -- "$argv"
        echo "matched" | string pad -c ' ' 
    end
    string match --regex '[[:alnum:]]' "$argv"

    # padding a stirng
    string pad --char " " $argv 

    set_color --background black white 
    set -l variable_name "v" 
    whatis -? --config-file --help --regex "*" 

    set -l variable_name (string split0 --fields 1 --right --max 4 '\t' "$argv")
    
    string pad --width 10 --char " " "$argv" 

    set -l variable_name "value" 


    if test -n "$variable_name" 
        echo "variable_name is not empty" 
    end

    for i in (seq 1 (count $variable_name))
    end

    for i in $variable_name
        echo $i
    end
    set variable_name "value" 
end

set -g x 'outside'`
//


// pass 1: get all local definitions, (including scopes)
// pass 2: get all commands, then find their deinition

// HERE
 describe('symbol map tests', () => {
    //it('getting workspaceSymbol map 1', async () => {
    //    const testFiles: string[] = [testCommandFile1, testCompleteFile2]
    //    const rootNodes = await getRootNodesForTestFiles(testFiles) 
    //    rootNodes.forEach((root, i) => {
    //        const uri = `file://symbol_map_test_${i}.fish`
    //        printTestName(uri, SHOULD_LOG)
    //        const symbols: DocumentSymbol[] = collectDocumentSymbols(SpanTree.defintionNodes(root));
    //        logFile(SHOULD_LOG, uri, root.text)
    //        //symbols.forEach(sym =>  logDocSymbol(SHOULD_LOG, sym) )
    //        expect(symbols.length > 0).toBe(true);

    //        // NEARBY SYMBOLS
    //        if (SHOULD_LOG) console.log("TESTING NEARBY SYMBOLS".bgBlack.underline)
    //        let currentNode: SyntaxNode = root;
    //        if (i === 0) {
    //            currentNode = root.descendantForPosition({column: 6, row: 9}).lastChild || root.descendantForPosition({column: 6, row: 9})
    //        } else {
    //            currentNode = root.descendantsOfType('function_definition').at(0)?.lastChild || root.descendantsOfType('function_definition').at(0) || root.lastNamedChild || root
    //        }
    //        if (SHOULD_LOG) console.log("currentNode:".white, currentNode?.text.red.bold, currentNode?.endPosition)
    //        const nearSymbols = nearbySymbols(root, currentNode)
    //        nearSymbols.forEach((sym) => {
    //            if (SHOULD_LOG) console.log(`nearby symbol: ${sym.name}`)
    //        })
    //        expect(nearbySymbols.length > 0).toBe(true);

    //        // FLATTEN SYMBOLS
    //        if (SHOULD_LOG) console.log("TESTING FLATTEN SYMBOLS".bgBlack.underline)
    //        const flatSym = flattenSymbols(symbols, symbols.children || [])
    //        flatSym.forEach((sym) => {
    //            if (SHOULD_LOG) console.log(`flat symbol: ${sym.name.bgBlack}`)
    //        })
    //        expect(flatSym.length > 0).toBe(true);
    //    })
    //}, 2000)

    it('buildingSpans', async () => {
        SHOULD_LOG = true
        const rootNodes = await getRootNodesFromTexts(testCommandFile1, testCompleteFile2) 
        rootNodes.forEach((root, i) => {
            const uri = `file://symbol_map_test_${i}.fish`
            printTestName(uri, SHOULD_LOG)
            const spans: SpanNode[] = []
            buildSpans(root, spans);
            const symbols: DocumentSymbol[] = [];
            logSpan(spans[0])
            //testcollectDocumentSymbols(root, spans, symbols);
            //const flat : DocumentSymbol[] = [];
            //flattenDocSymbols(symbols.at(0)!, flat)
            //logSymbols(flat);

        })
        SHOULD_LOG = false
    })

})

function logSpan(n: SpanNode) {
    console.log("span: \n".bgRed, n?.text.toString(), n?.type, n?.startPosition, n?.endPosition)
    n.innerSpans.forEach((child) => {
        logSpan(child)
    })
}

function logSymbols(symbols: DocumentSymbol[]) {
    symbols.forEach((sym) => {
        printDebugSeperator(true)
        console.log(sym)
        //logSymbol(sym)
        printDebugSeperator(true)
        logSymbols(sym.children || [])
    })
}
function logSymbol(n: DocumentSymbol, depth: number = 0) {
    if (n === undefined) return
    let logStr = "symbol: ".black.bgCyan + n?.name.split('\n').map(t=> t.yellow.bgBlack).join('\n') + "\n" + "kind: ".black.bgCyan + symbolKindToString(n.kind).black.bgRed + '\n'
    let indentStr = "    ".repeat(depth)
    console.log(`${indentStr.black.bgCyan}` + logStr.trim().split('\n').join(`\n${indentStr.black.bgCyan}`))
    printDebugSeperator(true)
    n.children?.forEach((child) => {
        logSymbol(child, depth + 1)
    })

}            

function flattenDocSymbols(parent: DocumentSymbol, symbols: DocumentSymbol[]):boolean {
    let shouldFlatten = parent.kind === SymbolKind.Namespace
    let newChildren: DocumentSymbol[] = []
    if (parent.children) {
        newChildren = []
        for (const child of parent.children) {
            if (child.kind === SymbolKind.Namespace) {
                flattenDocSymbols(child, newChildren)
            } if (child.kind === SymbolKind.Variable) {
                newChildren.push(child)
            } else if (child.kind === SymbolKind.Function) {
                flattenDocSymbols(child, newChildren)
                newChildren.push(child)
            } else {
                console.log("unknown child kind: ".bgRed, child.kind)
            }
        }
    }
    if (shouldFlatten) {
        symbols.push(...newChildren)
    } else {
        symbols.push(parent)
    }
    return shouldFlatten
}

interface SpanNode extends SyntaxNode {
    span: Range
    innerSpans: SpanNode[]
}

function buildSpans(root: SyntaxNode, spans: SpanNode[] = []): boolean {
    let isSpan = isScope(root);
    const spanNode : SpanNode = root as SpanNode;
    const innerSpans: SpanNode[] = [];

    for (const c of root.children) {
        const childSpan = buildSpans(c, innerSpans);
        isSpan = isSpan || childSpan;
    }

    if (isSpan) {
        spanNode.span = getRange(root);
        spanNode.innerSpans = innerSpans;
        spans.push(spanNode);
    }

    return isSpan
}

// TODO: look at recent test, all symbols can be made by using the spanNodes
// take spans, check if parent should be included,  
function testcollectDocumentSymbols(parent: SyntaxNode, spans: SpanNode[], symbols: DocumentSymbol[]) {
    let shouldInclude = isFunctionDefinitionName(parent) || isVariableDefinition(parent);
    let kind = toSymbolKind(parent);
    let range = getRange(parent);
    const childrenSymbols : DocumentSymbol[] = [];
    for (const currentSpan of spans) {
        const cSymbols: DocumentSymbol[] = [];
        for (const childNode of parent.children) {
            if (!containsRange(currentSpan.span, getRange(childNode))) continue
            const included = testcollectDocumentSymbols(childNode, currentSpan.innerSpans, cSymbols);
            shouldInclude = included  || shouldInclude;
        }
        if (cSymbols.length > 0) {
            childrenSymbols.push(...cSymbols)
        }
    }
    if (shouldInclude) {
        const symbol = {
            name: parent.text,
            kind: kind,
            range: range,
            selectionRange: range,
            children: childrenSymbols
        }
        symbols.push(symbol);
    }
    return shouldInclude;
}


// helper functions specific to these tests

function logTestFileInfo(filename = "-1" , rootNode: SyntaxNode, shouldLog = false) {
    if (!shouldLog) return;
    if (filename !== "-1") {
        console.log(`TESTFILE: ${filename}\n`)
    }
    console.log(`TREE:\n${rootNode.toString()}\n`)
    console.log(`TEXT:\n${rootNode.text.toString()}\n`);
}




