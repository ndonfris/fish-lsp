import { homedir } from 'os'
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes, getNodeAtRange, getNodesTextAsSingleLine, nodesGen } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, TextDocumentItem } from 'vscode-languageserver'
import { initializeParser } from '../src/parser';
import { getExtraEndSyntaxError, getMissingEndSyntaxError, getReturnSiblings, getUnreachableCodeSyntaxError } from '../src/diagnostics/syntaxError';
import { getUniversalVariableDiagnostics } from '../src/diagnostics/universalVariable';
import { createAllFunctionDiagnostics } from '../src/diagnostics/missingFunctionName';
import  {  collectDiagnosticsRecursive, collectFunctionNames, collectFunctionsScopes, getDiagnostics } from '../src/diagnostics/validate'
import {isCommand, isConditionalCommand, isFunctionDefinition, isFunctionDefinitionName, isReturn} from '../src/utils/node-types';
import {LspDocument} from '../src/document';
import {logNode, resolveLspDocumentForHelperTestFile} from './helpers';

let SHOULD_LOG = false
const jestConsole = console;

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
    SHOULD_LOG = false
});


function fishTextDocumentItem(uri: string, text: string): LspDocument {
    return new LspDocument({
        uri: `file://${homedir()}/.config/fish/${uri}`,
        languageId: 'fish',
        version: 1,
        text
    } as TextDocumentItem)
}

function severityStr(severity: DiagnosticSeverity | undefined) {
    switch (severity) {
        case DiagnosticSeverity.Error: return 'Error';
        case DiagnosticSeverity.Warning: return 'Warning';
        case DiagnosticSeverity.Information: return 'Information';
        case DiagnosticSeverity.Hint: return 'Hint';
        default: return 'Unknown';
    }
}

function logDiagnostics(diagnostic: Diagnostic, root: SyntaxNode) {
    if (SHOULD_LOG) {
        console.log('-'.repeat(80));
        console.log(`entire text:     \n${root.text.slice(0, 20)+'...'}`);
        console.log(`diagnostic node: ${getNodeAtRange(root, diagnostic.range)?.text}`);
        console.log(`message:         ${diagnostic.message.toString()}`); // check uri for config.fish
        console.log(`severity:        ${severityStr(diagnostic.severity)}`); // check uri for config.fish
        console.log(`range:           ${JSON.stringify(diagnostic.range)}`); // check uri for config.fish
        console.log('-'.repeat(80));
    }
}

describe('test diagnostics', () => {
    it('test simple function diagnostics', async () => {
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            resolveLspDocumentForHelperTestFile(
                "fish_files/simple/func_a.fish",
                true
            ),
            resolveLspDocumentForHelperTestFile(
                "fish_files/simple/func_a.fish",
                false
            ),
        ];
        docs.forEach((doc: LspDocument, index: number) => {
            const root = parser.parse(doc.getText()).rootNode;
            const diagnostics: Diagnostic[] = [];
            const funcNames: string[] = []
            getChildNodes(root).filter(isFunctionDefinitionName).forEach((node) => {
                if (collectFunctionNames(node, doc, diagnostics, funcNames)) {
                    logNode(SHOULD_LOG, node);
                }
            })
            if (index === 0) expect(diagnostics).toHaveLength(4);
            if (index === 1) expect(diagnostics).toHaveLength(1);
        })
    })


    it('test universal variable', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tVARIABLES');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
             fishTextDocumentItem(`config.fish`,'set -U universal_var universal_value'),
             fishTextDocumentItem(`functions/random_func.fish`, 'set -Ug universal_var universal_value'),
             fishTextDocumentItem(`functions/other_func.fish`, 'for i in (seq 1 10);set -U universal_var universal_value;end'),
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            for (const node of nodesGen(root)) {
                const diagnostic = getUniversalVariableDiagnostics(node, doc);
                if (diagnostic) {
                    if (SHOULD_LOG) logDiagnostics(diagnostic, root)
                    diagnosticsErrors.push(diagnostic);
                }
            }
        })
        expect(diagnosticsErrors.length).toBe(3);
    })

    it('test missing end', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tMISSING END BLOCKS');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/pass_begin_block.fish`, 'begin; printf "hello "; printf "world\\n"; end'),                     // no diagnostics
            fishTextDocumentItem(`functions/fail_begin_block.fish`, 'for i in (seq 1 10); printf "hello "; printf "world";'),              // missing end diagnostic
            fishTextDocumentItem(`functions/fail_random_func.fish`, 'function fail_random_func; if test -z $argv; echo "match"; end;'),   // missing end diagnostic
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            for (const node of nodesGen(root)) {
                const d = getMissingEndSyntaxError(node)
                if (!d) continue;
                if (SHOULD_LOG) logDiagnostics(d, root)
                diagnosticsErrors.push(d);
            }
        })
        expect(diagnosticsErrors.length).toBe(2);
    })

    it('test extra end', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tEXTRA END BLOCKS');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/fail_extra_end.fish`,  'function fail_extra_end; if test -z $argv; echo "match"; end;end;end'),   // missing end diagnostic
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            for (const node of nodesGen(root)) {
                const d = getExtraEndSyntaxError(node);
                if (!d) continue;
                if (SHOULD_LOG) logDiagnostics(d, root)
                diagnosticsErrors.push(d);
            }
        })
        expect(diagnosticsErrors.length).toBe(1);
    })

    it('test unreachable code', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tUNREACHABLE CODE');
        const parser = await initializeParser();
        const docs: LspDocument[] = unreacableDocs()
        const diagnosticsErrors: Diagnostic[] = [];
        let root = parser.parse(docs[0].getText()).rootNode;
        docs.forEach(doc => {
            parser.reset()
            root = parser.parse(doc.getText()).rootNode;
            for (const node of nodesGen(root)) {
                const diagnostic = getUnreachableCodeSyntaxError(node);
                if (!diagnostic) continue;
                diagnosticsErrors.push(diagnostic);
                if (SHOULD_LOG) logDiagnostics(diagnostic, root)
            }
        })
        expect(diagnosticsErrors.length).toBe(3);
    })

    it('test bad function name', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tURI FUNCTION NAME');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/pass_func.fish`, 'function pass_func;begin; printf "hello "; printf "world\\n"; end;end;'),         // no diagnostics
            fishTextDocumentItem(`functions/fail_func.fish`, 'function should_fail_func;begin; printf "hello "; printf "world\\n"; end;end;'),  // bad func name diagnostics
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            const diagnostics = createAllFunctionDiagnostics(root, doc);
            if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
            diagnosticsErrors.push(...diagnostics)
        })
        expect(diagnosticsErrors.length).toBe(1);
    })

    it('test duplicate function name', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tDUPLICATE FUNCTION NAME');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/pass_func.fish`, 'function pass_func;begin; printf "hello "; printf "world\\n";end;end;'),         // no diagnostics
            fishTextDocumentItem(`functions/duplicate_func.fish`, ['function should_fail_func;echo "hi";end;', 'function should_fail_func; echo "world"; end;'].join('\n')),  // bad func name diagnostics
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            const diagnostics = createAllFunctionDiagnostics(root, doc);
            if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
            diagnosticsErrors.push(...diagnostics);
        })
        expect(diagnosticsErrors.length).toBe(3);
    })

    

const test_text =
`function pass_func
    if test 'a' = 'b'
        for i in (seq 1 10)
            echo $i
        end
        return 0;
    end
    return 1;
    and echo "line 1"
    and echo "line 2"
    or  echo "line 3"
    echo "outside of block"
end
`

const test_command_chain_block_text =
`function pass_func
    if test 'a' = 'b'
        for i in (seq 1 10)
            echo $i
        end
        return 0;
    end
    echo "before block"
    echo "start of block"
    and echo "line 1"
    or  echo "line 2"
    and echo "line 3";
    echo "outside of block 1"
    echo "outside of block 2"
    echo "outside of block 3"
end
`

    it('return spans', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tVALIDATE');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/pass_func.fish`, test_text),         // no diagnostics
            fishTextDocumentItem(`functions/command_chain_func.fish`, test_command_chain_block_text),         // no diagnostics
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            console.log(doc.uri)
            for (const node of nodesGen(root)) {
                if (!node.isNamed()) continue;
                if (isReturn(node)) {
                    //console.log('-'.repeat(50));
                    let result : SyntaxNode[] = []
                    let current: SyntaxNode | null = node
                    let outOfRange = false;
                    while (current) {
                            console.log("current: " + getNodesTextAsSingleLine([current]))
                            if (!outOfRange && isConditionalCommand(current)) {
                                current = current.nextNamedSibling;
                                continue;
                            }
                            if (!outOfRange && !isConditionalCommand(current)) {
                                result.push(current);
                                outOfRange = true;
                            } else if (outOfRange) {
                                result.push(current);
                                outOfRange = true;
                            }
                            current = current.nextNamedSibling;
                    }

                    const logStr = `group: ${result}, chain_length: ${result.length}\n${getNodesTextAsSingleLine(result)}`

                }
            }
        })
    })

    it('validate', async () => {
        SHOULD_LOG = false
        if (SHOULD_LOG) console.log('\n\n\t\tVALIDATE');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            //fishTextDocumentItem(`functions/pass_func.fish`, `function pass_func;set -U asdf 'g';end; function pass_func; echo $argv;end;`),         // no diagnostics
            //fishTextDocumentItem(`functions/duplicate_func.fish`, ['function should_fail_func;echo "hi";end;', 'function should_fail_func; echo "world"; end;'].join('\n')),  // bad func name diagnostics
           resolveLspDocumentForHelperTestFile('fish_files/simple/multiple_broken_scopes.fish') 
        ];
        const doc : LspDocument = resolveLspDocumentForHelperTestFile('fish_files/simple/multiple_broken_scopes.fish')
        let diagnostics: Diagnostic[] = [];
        parser.reset()
        const funcDoc = convertToAutoloadDocument(doc)
        const root = parser.parse(funcDoc.getText()).rootNode;
        for (const node of nodesGen(root)) {
            if (isFunctionDefinition(node)) {
                collectFunctionsScopes(node, funcDoc, diagnostics);
            }
        }
        //const diagnostics = collectDiagnosticsRecursive(root, funcDoc);
        if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
        //diagnostics.push(...diagnostics);
        //expect(diagnosticsErrors.length).toBe(5);
    })

})



function convertToAutoloadDocument(doc: LspDocument) {
    const funcDoc = new LspDocument({ uri: `file://${homedir()}/.config/fish/functions/multiple_broken_scopes.fish`, languageId: doc.languageId, version: doc.version, text: doc.getText()});
    return funcDoc
}

function unreacableDocs() {
    return [
        fishTextDocumentItem(`functions/unreachable_code.fish`,  // early return  
        'function unreachable_code; return true;if test -z $argv; echo "match"; end;end'),
        fishTextDocumentItem(`functions/unreachable_code_1.fish`, // early return + multiple children
        `function unreachable_code_1\n\treturn 0;\n\tif test -z $argv;\n\t\treturn true;\n\tend;\n\techo $argv;\nend`), 
        fishTextDocumentItem(`functions/reachable_code.fish`, // conditional return so is reachable
        'function reachable_code; echo $argv;and return true;if test -z $argv; echo "match"; end;end'),
        fishTextDocumentItem(`functions/reachable_code.fish`, // conditional return so is reachable
        `function reachable_code;if test -n $argv;return 0;end;return 1;end;`)
    ]
}


