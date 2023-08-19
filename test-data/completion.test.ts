import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem,  CompletionContext, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier, CompletionTriggerKind} from 'vscode-languageserver';
import { assert } from 'chai'
import { generateCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {resolve} from 'dns';
import {LspDocument} from '../src/document';
import { DocumentationCache, initializeDocumentationCache } from '../src/utils/documentationCache'
import { containsRange, getDefinitionSymbols, getNearbySymbols} from '../src/workspace-symbol';
import {getNodeAtRange, getRange} from '../src/utils/tree-sitter';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';
import { setLogger } from './helpers'
import { execCompleteGlobalDocs, execCompleteVariables, execCompletionHelper, execEscapedCommand } from '../src/utils/exec';
//import  from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { toLspDocument } from '../src/utils/translation';
import { homedir } from 'os';
import { FishCompletionItem, FishCompletionItemKind, toCompletionKindString } from '../src/utils/completion-strategy';

let parser: Parser;
let workspaces: Workspace[] = []
let analyzer: Analyzer;

setLogger(
    async () => {
        parser = await initializeParser();
        workspaces = await initializeDefaultFishWorkspaces()
        analyzer = new Analyzer(parser, workspaces);
    },
    async () => {
        parser.reset();
    }
)

const spoofedPath = `${homedir()}/.config/fish/functions`

function noMock(filename: string){
    return filename.startsWith(spoofedPath) && filename.endsWith('.fish')
}
function getMockFile(filename: string){
    if (noMock(filename)) return filename
    const startIdx = filename.lastIndexOf('/') ===  -1 ? 0 : filename.lastIndexOf('/')
    const endIdx = filename.lastIndexOf('.fish') === -1 ? filename.length : filename.lastIndexOf('.fish')
    //console.log({startIdx, endIdx});
    const name = filename.slice(startIdx, endIdx)
    return `${spoofedPath}/${name}.fish`
}

function createContext(kind: CompletionTriggerKind, character?: string) : CompletionContext  {
    return { 
        triggerKind: kind,
        triggerCharacter: character,
    }
}

function mockAnalyzeCompletion(filename: string, ...lines: string[]){
    let path = getMockFile(filename)
    let content = lines.join('\n')
    const doc = toLspDocument(path, content)
    analyzer.analyze(doc);
    let pos = doc.getLineEnd(doc.lineCount)
    let node = analyzer.nodeAtPoint(doc.uri, pos.line, pos.character)!
    return {
        document: doc,
        position: { line: pos.line, character: pos.character + 1},
        analyzer: analyzer,
        node: node,
    }
}


describe('complete simple tests', () => {

    it('complete analyze functions (with autoload)', async () => {
        const {document, position, analyzer} = mockAnalyzeCompletion('test_1', ...[
            'function test_1', 
            '   echo "hello 1"',
            'end',
            'function test_2', 
            '   echo "hello 2"',
            'end',
            'function test_3', 
            '   echo "hello 3"',
            'end',
            'test_'
        ])
        const context = createContext(CompletionTriggerKind.Invoked)

        const completions = await generateCompletionList(document, analyzer, position, context)
        //TestCompletionItem.log(completions, 3)
        assert.deepEqual(completions.slice(0,3).map(TestCompletionItem.fromCompletion), [
            TestCompletionItem.create('test_3', FishCompletionItemKind.LOCAL_FUNCTION),
            TestCompletionItem.create('test_2', FishCompletionItemKind.LOCAL_FUNCTION),
            TestCompletionItem.create('test_1', FishCompletionItemKind.USER_FUNCTION),
        ])
    })
    it('complete analyze variables', async () => {
        const {document, position, analyzer} = mockAnalyzeCompletion('test_2', ...[
            `set -gx test_a 'a'`,
            `set -gx test_b 'b'`,
            `set -gx test_c 'c'`,
            `set -gx test_d 'd'`,
            `set -gx test_e 'e'`,
            `if set -q test_`
        ])
        const context = createContext(CompletionTriggerKind.Invoked)

        const completions = await generateCompletionList(document, analyzer, position, context)
        //TestCompletionItem.log(completions)

        assert.deepEqual(
            completions.slice(0,5).map(TestCompletionItem.fromCompletion),
            [
                TestCompletionItem.create('test_e', FishCompletionItemKind.GLOBAL_VARIABLE),
                TestCompletionItem.create('test_d', FishCompletionItemKind.GLOBAL_VARIABLE),
                TestCompletionItem.create('test_c', FishCompletionItemKind.GLOBAL_VARIABLE),
                TestCompletionItem.create('test_b', FishCompletionItemKind.GLOBAL_VARIABLE),
                TestCompletionItem.create('test_a', FishCompletionItemKind.GLOBAL_VARIABLE)
            ]
        )
    })

    it('complete functions nested', async () => {
        const {document, position, analyzer} = mockAnalyzeCompletion('test_3', 
            'function test_3',
            `     set test_a 'a'`,
            `     set test_b 'b'`,
            `     set test_c 'c'`,
            `     set test_d 'd'`,
            `     set test_e 'e'`,
            '     function test_inner',
            `          set -f test_f 'f'`,
            '     end',
            '     test_inner',
            `end`,
            `test_`,
        )
        const context = createContext(CompletionTriggerKind.Invoked)

        const completions = await generateCompletionList(document, analyzer, position, context)
        const funcs = completions.filter(
            (c) =>
                (
                    c.fishKind === FishCompletionItemKind.USER_FUNCTION ||
                    c.fishKind === FishCompletionItemKind.LOCAL_FUNCTION 
                ) && c.localSymbol
        );
        //TestCompletionItem.log(funcs, 12)
        //console.log(document.uri);
        assert.equal(funcs.length, 1);
    })

    it('complete `set -`', async () => {
        function filterFlags(items: FishCompletionItem[]){
            return items.filter((c) => c.fishKind === FishCompletionItemKind.FLAG)
        }
        async function getFlags(context: CompletionContext){
            let {document, position, analyzer} = mockAnalyzeCompletion('test_4', `set -`)
            let completions = await generateCompletionList(document, analyzer, position, context)
            return completions
        }
        let context = createContext(CompletionTriggerKind.Invoked) // test TriggerCharacter: '-'
        let invokedFlags = await getFlags(context)
        TestCompletionItem.log(invokedFlags, 100)

        context = createContext(CompletionTriggerKind.TriggerCharacter, '-') // test TriggerCharacter: '-'
        let triggerFlags = await getFlags(context)
        TestCompletionItem.log(triggerFlags, 100)

        //console.log(document.uri);
        //assert.equal(funcs.length, 1);
    })
})



export namespace TestCompletionItem {

    export interface Item {
        label: string,
        kind: string,
        fishKind: string,
    }

    export function fromCompletion(cmp: FishCompletionItem) : Item {
        return {
            label: cmp.label,
            kind: toCompletionKindString[cmp.fishKind],
            fishKind: FishCompletionItemKind[cmp.fishKind],
        }
    }

    export function create(label: string, fishKind: FishCompletionItemKind ) : Item {
         return {
             label: label,
             kind: toCompletionKindString[fishKind], 
             fishKind: FishCompletionItemKind[fishKind],
        }
    }

    export function readable(item: FishCompletionItem){
        return {
            ...item,
            kind: toCompletionKindString[item.fishKind],
            fishKind: FishCompletionItemKind[item.fishKind],
        };
    }

    export function log(items: FishCompletionItem[], max: number = 5){
        items.forEach((item: FishCompletionItem, i: number) => {
            if (i < max) console.log(i, '::', readable(item), '\n');
        })
        console.log(`...`)
        console.log(`total items: ${items.length}`);
    }
}