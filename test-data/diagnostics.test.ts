import os from 'os'
import { SyntaxNode } from 'web-tree-sitter';
import { getNodeAtRange, getSiblingNodes, nodesGen } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, TextDocumentItem } from 'vscode-languageserver'
import { initializeParser } from '../src/parser';
import { getExtraEndSyntaxError, getMissingEndSyntaxError, getUnreachableCodeSyntaxError } from '../src/diagnostics/syntaxError';
import { getUniversalVariableDiagnostics } from '../src/diagnostics/universalVariable';
import { createAllFunctionDiagnostics } from '../src/diagnostics/missingFunctionName';
import  {  getDiagnostics } from '../src/diagnostics/validate'
import * as errorCodes from '../src/diagnostics/errorCodes';
import {isReturn} from '../src/utils/node-types';
import {LspDocument} from '../src/document';

let SHOULD_LOG = false
const jestConsole = console;
jest.setTimeout(25000)

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
    SHOULD_LOG = false
});


function fishTextDocumentItem(uri: string, text: string): LspDocument {
    return new LspDocument({
        uri: `file://${os.homedir()}/.config/fish/${uri}`,
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
        console.log(`entire text:     \n${root.text}`);
        console.log(`diagnostic node: ${getNodeAtRange(root, diagnostic.range)?.text}`);
        console.log(`message:         ${diagnostic.message.toString()}`); // check uri for config.fish
        console.log(`severity:        ${severityStr(diagnostic.severity)}`); // check uri for config.fish
        console.log(`range:           ${JSON.stringify(diagnostic.range)}`); // check uri for config.fish
        console.log('-'.repeat(80));
    }
}

describe('test diagnostics', () => {
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
        SHOULD_LOG = true
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
        SHOULD_LOG = true
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

    it('validate', async () => {
        SHOULD_LOG = true
        if (SHOULD_LOG) console.log('\n\n\t\tVALIDATE');
        const parser = await initializeParser();
        const docs: LspDocument[] = [
            fishTextDocumentItem(`functions/pass_func.fish`, `function pass_func;set -U asdf 'g';end; function pass_func; echo $argv;end;`),         // no diagnostics
            fishTextDocumentItem(`functions/duplicate_func.fish`, ['function should_fail_func;echo "hi";end;', 'function should_fail_func; echo "world"; end;'].join('\n')),  // bad func name diagnostics
        ];
        const diagnosticsErrors: Diagnostic[] = [];
        docs.forEach(doc => {
            parser.reset()
            const root = parser.parse(doc.getText()).rootNode;
            const diagnostics = getDiagnostics(root, doc);
            if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
            diagnosticsErrors.push(...diagnostics);
        })
        expect(diagnosticsErrors.length).toBe(5);

    })
})



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


