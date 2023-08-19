import { homedir } from "os";
import { assert } from "chai";
import { setLogger,  createTestWorkspaceDocuments, createFakeUriPath, truncatedNode, printNodes } from "./helpers";
import { DocumentSymbol, Position, SymbolKind, Location, TextDocumentItem, } from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { Analyzer } from "../src/analyze";
import {filterLastPerScopeSymbol, FishDocumentSymbol, } from "../src/document-symbol";
import {FishWorkspace,initializeDefaultFishWorkspaces,Workspace,} from "../src/utils/workspace";
import { WorkspaceSpoofer } from "./workspace-builder";
import { findEnclosingScope, getChildNodes, getRange, positionToPoint, } from "../src/utils/tree-sitter";
import {isCommand, isCommandName, isFunctionDefinitionName, isVariable, } from "../src/utils/node-types";
import { LspDocument } from "../src/document";
import { containsRange } from "../src/workspace-symbol";
import { canRenamePosition, getRenameLocations, getRenameSymbolType } from "../src/workspace-symbol";

let parser: Parser;
let analyzer: Analyzer;

setLogger(
    async () => {
        parser = await initializeParser();
        analyzer = new Analyzer(parser)
        createTestWorkspaceDocuments({
            "config.fish": [
                'rename',                                 // test3 here
                'set -gx var "global var"',               // test2 here
            ],
            "functions/use-var.fish": [
                'function use-var',
                '    echo $var',
                'end'
            ],
            "functions/rename.fish": [
                "function rename",
                "    set var a",                          // test1 here
                "    echo \"var: $var\"",
                "end",
            ],
            "functions/rename2.fish": [
                "function rename2 --argument-names var",  // test5 here
                '    echo $var',
                "end",
            ],
            "functions/argv-rename.fish": [
                "function argv-rename",
                "    set -l test-v \"$argv[1]\"",
                '    echo $argv',
                '    echo $test-v',
                "end",
            ],
            "functions/with-helper.fish": [
                'function with-helper',
                '    __helper',
                'end',
                'function __helper',                      // test6 here
                '    echo "helper"',
                'end',
            ],
            "completions/with-helper.fish": [
                'function _cmp_helper',
                '    printf "%s%s\n" \'h\' \'help msg\'',
                'end',
                'complete -c with-helper -f -a "_cmp_helper"',
            ]
        }, analyzer)
    },
)

function createTestData(uriName: string, line: number, column: number):{
    uri: string,
    document: LspDocument,
    position: Position,
}{
    const uri = createFakeUriPath(uriName)
    const document = analyzer.getDocument(uri)!
    const position = Position.create(line, column)
    return {
        uri,
        document,
        position,
    }
}

const logLocations = (locations: Location[]) => {
    locations.forEach((loc, index) => {
        console.log(`location ${index}: `,JSON.stringify(loc, null, 2));
    })
}

const createTestLocation = (uriName: string, startLine: number, startChar: number, endLine: number, endChar: number) => {
    return {
        uri: createFakeUriPath(uriName),
        range: {
            start: {
                line: startLine,
                character: startChar,
            },
            end: {
                line: endLine,
                character: endChar,
            }
        }
    }
}

describe("rename tests", () => {
 
    it("local variable rename     (test1)", async () => {
        const test1 = createTestData('functions/rename.fish', 1, 9)
        assert.equal(    canRenamePosition(analyzer, test1.document, test1.position), true);
        assert.equal(  getRenameSymbolType(analyzer, test1.document, test1.position), 'local');
        const result1 = getRenameLocations(analyzer, test1.document, test1.position)
        //logLocations(result1)
        assert.deepEqual(result1, [
            createTestLocation('functions/rename.fish', 1, 8, 1, 11),
            createTestLocation('functions/rename.fish', 2, 16, 2, 19),
        ])

    })

    it("global variable rename    (test2)", async () => {
        const test2 = createTestData('config.fish', 1, 9)
        //printNodes(analyzer.getRootNode(test2.document)!)
        assert.equal(canRenamePosition(analyzer, test2.document, test2.position), true);
        assert.equal(getRenameSymbolType(analyzer, test2.document, test2.position), 'global');
        const result2 = getRenameLocations(analyzer, test2.document, test2.position)
        //logLocations(result2)
        assert.equal(result2.length, 2)
        assert.deepEqual(result2, [
            createTestLocation('config.fish', 1, 8, 1, 11),
            createTestLocation('functions/use-var.fish', 1, 10, 1, 13),
        ])

    })

    it("global function rename    (test3)", async () => {
        const test3 = createTestData('functions/rename.fish', 0, 9)
        assert.equal(canRenamePosition(analyzer, test3.document, test3.position), true);
        assert.equal(getRenameSymbolType(analyzer, test3.document, test3.position), 'global');
        const result3 = getRenameLocations(analyzer, test3.document, test3.position)
        //logLocations(result3)
        assert.equal(result3.length, 2)
        assert.deepEqual(result3, [
            createTestLocation('config.fish', 0, 0, 0, 6),
            createTestLocation('functions/rename.fish', 0, 9, 0, 15),
        ])
    })

    it("shouldn't rename          (test4)", async () => {
        const test4 = createTestData('functions/rename.fish', 0, 0)
        assert.equal(canRenamePosition(analyzer, test4.document, test4.position), false);
        const result4 = getRenameLocations(analyzer, test4.document, test4.position)
        assert.equal(result4.length, 0)
    })


    it("local arg variable rename (test5)", async () => {
        let test5 = createTestData('functions/rename2.fish', 0, 35)
        //printNodes(analyzer.getRootNode(test5.document)!)
        assert.equal(canRenamePosition(analyzer, test5.document, test5.position), true);
        let result5 = getRenameLocations(analyzer, test5.document, test5.position)
        //logLocations(result5)
        assert.equal(result5.length, 2)
        assert.deepEqual(result5, [
            createTestLocation('functions/rename2.fish', 0, 34, 0, 37),
            createTestLocation('functions/rename2.fish', 1, 10, 1, 13),
        ])
    })

    it("local function rename     (test6)", async () => {
        let test6 = createTestData('functions/with-helper.fish', 3, 10)
        //printNodes(analyzer.getRootNode(test6.document)!)
        assert.equal(canRenamePosition(analyzer, test6.document, test6.position), true);
        let result6 = getRenameLocations(analyzer, test6.document, test6.position)
        //logLocations(result6)
        assert.equal(result6.length, 2)
        assert.deepEqual(result6, [
            createTestLocation('functions/with-helper.fish', 1,  4, 1, 12),
            createTestLocation('functions/with-helper.fish', 3,  9, 3, 17),
        ])
    })



    it("WorkspaceEdit RenameFile  (test7)", async () => {
        let test7 = createTestData('functions/with-helper.fish', 0, 10)
        //printNodes(analyzer.getRootNode(test7.document)!)
        //assert.equal(canRenamePosition(analyzer, test6.document, test6.position), true);
        let result7 = getRenameLocations(analyzer, test7.document, test7.position)
        //logLocations(result7)
        //assert.equal(result6.length, 2)
        assert.deepEqual(result7, [
            createTestLocation('functions/with-helper.fish',   0,  9, 0, 20),
            createTestLocation('completions/with-helper.fish', 4,  12, 4, 23),
        ])
    })

})