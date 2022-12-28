import { logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName } from './helpers';
import { SyntaxNode } from 'web-tree-sitter';
import { DocumentSymbol, Location, SymbolInformation, WorkspaceSymbol } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { getChildNodes, getNodeAtRange } from '../src/utils/tree-sitter';
import { isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition, isCommand, isCommandName, findEnclosingVariableScope } from '../src/utils/node-types'
//import { collectSymbolInformation, FishSymbolMap } from '../src/workspace-symbol'
import { getDefinitionSymbols } from '../src/symbols'
import {execFindDependency} from '../src/utils/exec';
import {isBuiltin} from '../src/utils/builtins';
//import {DocumentManager} from '../src/document';
import {collectDocumentSymbols, collectSymbolInformation, flattenSymbols, nearbySymbols} from '../src/workspace-symbol'

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
        const rootNodes = await getRootNodesForTestFiles(testFiles)
        printTestName('PARSING FUNCTION NAMES SYNTAXNODES', SHOULD_LOG)
        rootNodes.forEach((rootNode, i) => {
            logTestFileInfo(i.toString(), rootNode)
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
        const rootNodes = await getRootNodesForTestFiles(testFiles)
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
        const testFiles = [testReadFile1, testReadFile2, testReadFile3];
        const rootNodes = await getRootNodesForTestFiles(testFiles)
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
        const rootNodes = await getRootNodesForTestFiles(testFiles)
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
        const rootNodes = await getRootNodesForTestFiles(testFiles)                      
        SHOULD_LOG = true;
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
        SHOULD_LOG = false;
    })                                                                                   

    it('parsing symbol enclosing scope', async () => {
        const testFiles = [testEnclosingScopeFile1];
        const rootNodes = await getRootNodesForTestFiles(testFiles)                      
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
// pass 1: get all local definitions, (including scopes)
// pass 2: get all commands, then find their deinition

// HERE
 describe('symbol map tests', () => {
    //it('getting symbolInfo map 1', async () => {
    //    const testFiles: string = [testCommandFile1].join('\n');
    //    const rootNodes = await getRootNodesForTestFiles([testFiles]) 
    //    const root = rootNodes[0];                                    
    //    const uri = 'file://symbol_map_test_1.fish'
    //    printTestName(uri, SHOULD_LOG)               
    //    const symbols: SymbolInformation[] = [];
    //    collectSymbolInformation(uri, root, symbols);
    //    for (const sym of symbols) {
    //        logSymbolInfo(SHOULD_LOG, sym)
    //    }
    //    logFile(SHOULD_LOG, uri, root.text)
    //    expect(true).toBe(true);
    //}, 20000)

    it('getting workspaceSymbol map 1', async () => {
        const testFiles: string = [testCommandFile1].join('\n');
        const rootNodes = await getRootNodesForTestFiles([testFiles]) 
        const root: SyntaxNode = rootNodes[0];                                    
        const uri = 'file://symbol_map_test_1.fish'
        //printTestName(uri, SHOULD_LOG)
        const symbols: DocumentSymbol[] = [];
        collectDocumentSymbols(uri, root, symbols);
        logFile(SHOULD_LOG || true, uri, root.text)
        const _currentNode= root.descendantForPosition({column: 6, row: 9}) // 9, 7 would be past
        const currentNode= _currentNode?.lastChild || _currentNode
        const nearSymbols = nearbySymbols(uri, root, currentNode)
        for (const sym of nearSymbols) {
            console.log(`nearby symbol: ${sym.name}`)
            //logDocSymbol(SHOULD_LOG || true, sym)
        }
        const s : DocumentSymbol[]= []
        const flatSym = flattenSymbols(symbols, s)
        for (const sym of flatSym) {
          console.log(`${sym.name.bgBlack}`)
          ////logDocSymbol(SHOULD_LOG || true, sym)
        }
        console.log("currentNode:".white, currentNode?.text, currentNode?.endPosition)
        expect(true).toBe(true);
    }, 20000)
////// 
//////     it('generic symbol map', async () => {
//////         const testFiles: string = [testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1].join('\n');
//////         const rootNodes = await getRootNodesForTestFiles([testFiles])
//////         const root = rootNodes[0];
//////         printTestName('GENERIC SYMBOL MAP', SHOULD_LOG)
//////         let dependencyMap = new Map<string, string>();
//////         for (const child of getChildNodes(root)) {
//////             if (isFunctionDefinitionName(child)) {
//////                 dependencyMap.set(child.text, 'testUri');
//////             }
//////         }
//////         for (let i = 0; i < 50; i++) {
//////             dependencyMap = await getDependencyMap(i.toString(), root, dependencyMap);
//////         }
//////         for (const [name, uri] of dependencyMap) {
//////             if (name && uri) {
//////                 //console.log(uri)
//////                 expect(true).toBe(true)
//////             }
//////         }
//////     }, 15000)
////// 
//////     it('new generic symbol map', async () => {
//////         const testFiles: string = [testCommandFile1, testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1,testCommandFile1].join('\n');
//////         const parser = await initializeParser();
//////         const rootNodes = await getRootNodesForTestFiles([testFiles])
//////         const root = rootNodes[0];
//////         printTestName('GENERIC SYMBOL MAP', SHOULD_LOG)
//////         //const docs = await DocumentManager.indexUserConfig();
//////         const allSymbols = new Map<string, Map<string, SymbolInformation[]>>()
//////         for (let i = 0; i < 50; i++) {
//////             const filename = "testing"
//////             //const symbols = allSymbols.has(filename) ? allSymbols.get(filename) : new Map<string, SymbolInformation[]>();
//////             //allSymbols.set(filename, collectSymbolInformation(filename, root))
//////         }
//////         for (const [uri, symbolMap] of allSymbols) {
//////             console.log(`test: ${uri}`)
//////             for (const [name, symbol] of symbolMap) {
//////                 if (name === "program") {
//////                     console.log(`parsing file of length: ${root.text.split('\n').length}, 50 times`)
//////                 }
//////                 //console.log(`${name} ${symbol.length}: ${symbol.map(s => `${ s.location.range.start.character },${ s.location.range.start.line }`).join(', ').slice(0, 40)}\n`)
//////                 expect(name.length > 0).toBe(true)
//////             }
//////         }
//////         expect(true).toBe(true)
//////     }, 25000)
////// 
//////     //it('generic symbol map', async () => {
//////     //    const testFiles = [testFunctionFile1, testFunctionFile2, testFunctionFile3];
//////     //    const rootNodes = await getRootNodesForTestFiles(testFiles)
//////     //    printTestName('GENERIC SYMBOL MAP', SHOULD_LOG)
//////     //    rootNodes.forEach((root, fileIdx) => {
//////     //        logTestFileInfo(fileIdx.toString(), root)
//////     //        const symbols = getDefinitionSymbols(`file://test_${fileIdx}.fish`, root)
//////     //        const nodes: SyntaxNode[] = [];
//////     //        for (const sym of symbols) {
//////     //            //nodes.push(sym.name)
//////     //            if (SHOULD_LOG) console.log(sym.name);
//////     //        }
//////     //        //expect(nodes.length).toEqual(3);
//////     //    })
//////     //})
////// 
//////     //it('growing symbol map', async () => {
//////     //    const fileVersion1 = testFunctionFile1;
//////     //    const fileVersion2 = [fileVersion1 , testSetFile1].join('\n');
//////     //    const fileVersion3 = [fileVersion2 , testReadFile1].join('\n');
//////     //    const fileVersion4 = [fileVersion3 , testForLoop1].join('\n');
//////     //    console.log(fileVersion4);
//////     //    const testFiles = [fileVersion1, fileVersion2, fileVersion3, fileVersion4];
//////     //    const rootNodes = await getRootNodesForTestFiles(testFiles)
//////     //    printTestName('GROWING SYMBOL MAP', SHOULD_LOG)
//////     //    let map = new Map<SyntaxNode, Location>();
//////     //    rootNodes.forEach(root => {
//////     //        const oldSize = map.size;
//////     //        map = getDefinitionLocations(`file://test_fileVersion.fish` , root, map)
//////     //        expect(map.size).toBeGreaterThan(oldSize);
//////     //    })
//////     //    const root = rootNodes[rootNodes.length - 1];
//////     //    for (const value of map.values()) {
//////     //        const node = getNodeAtRange(root, value.range)
//////     //        if (SHOULD_LOG) console.log(`found: ${node.text}`);
//////     //    }
//////     //    let count = 0;
//////     //    for (const node of getChildNodes(root)) {
//////     //        if (isVariableDefintion(node) || isFunctionDefinitionName(node)) {
//////     //            count++;
//////     //            console.log(node.text)
//////     //        } 
//////     //    }
//////     //    console.log(`variable count: ${count}, map size: ${map.size}`);
//////     //})
})

// helper functions specific to these tests

function logTestFileInfo(filename = "-1" , rootNode: SyntaxNode) {
    if (!SHOULD_LOG) return;
    if (filename !== "-1") {
        console.log(`TESTFILE: ${filename}\n`)
    }
    console.log(`TREE:\n${rootNode.toString()}\n`)
    console.log(`TEXT:\n${rootNode.text.toString()}\n`);
}

async function getRootNodesForTestFiles(textInfiles: string[]): Promise<SyntaxNode[]> {
    const parser = await initializeParser();
    const rootNodes: SyntaxNode[] = [];
    for (const t of textInfiles) {
        parser.reset()
        rootNodes.push(parser.parse(t).rootNode)
    }
    return rootNodes;
}



