
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { getFishDocumentSymbols, filterLastFishDocumentSymbols, FishDocumentSymbol, flattenFishDocumentSymbols,} from '../src/document-symbol'
import { initializeParser } from '../src/parser';
import { symbolKindToString } from '../src/symbols';
import { isVariableDefinitionName, refinedFindParentVariableDefinitionKeyword } from '../src/utils/node-types';
import { getChildNodes, getNodeAtRange } from '../src/utils/tree-sitter';
import { logNode, resolveLspDocumentForHelperTestFile } from './helpers';

let parser: Parser;

//const chalk = new Chalk();
//const term = new TerminalRenderer()
//marked.setOptions({
    //// Define custom renderer
    //renderer: term,
    //gfm: true,
//});
const jestConsole = console;
//setMarkedterminal();

beforeAll(async () => {
    parser = await initializeParser();
})
beforeEach(async () => {
    global.console = require("console");
});

afterEach(() => {
    global.console = jestConsole;
    parser.reset();
});

function documentSymbolString(symbol: FishDocumentSymbol, indent: number = 0): string {
    const indentStr = "   ".repeat(indent);
    return JSON.stringify({
        name: symbol.name,
        detail: symbol.detail.split('\n'),
        kind: symbolKindToString(symbol.kind),
        range: `${symbol.range.start.line}:${symbol.range.start.character} - ${symbol.range.end.line}:${symbol.range.end.character}`,
        selectionRange: `${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character} - ${symbol.selectionRange.end.line}:${symbol.selectionRange.end.character}`,
        children: symbol.children.map(c => JSON.parse(documentSymbolString(c, indent + 2)))
    }, null, 2).split('\n').map(line => indentStr + line).join('\n');
}


function debugOutput(title: string, symbols: FishDocumentSymbol[], options?: {off?: boolean, showTree?: boolean, showAllSymbols?: boolean, showNamesAndDescriptions?: boolean, showArray?: boolean}){
    if (options?.off) {
        return;
    } else {
        console.log();
        console.log(title);
        if (options?.showTree) {
            logClientTree(symbols);
            console.log();
        }
        if (options?.showAllSymbols) {
            for (const s of symbols) {
                console.log(documentSymbolString(s));
            }
            console.log();
        }
        if (options?.showNamesAndDescriptions) {
            logNameAndDescription(symbols);
            console.log();
        }
        if (options?.showArray) {
            for (const s of symbols) {
                console.log(s.name);
            }
            console.log();
        }
    }
}

function logNameAndDescription(symbols: FishDocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        const description = symbol.detail.length < 30 ? symbol.detail : symbol.detail.slice(0, 30) + '......';
        console.log("      ".repeat(level) + `${logIcon}${symbol.name} - \`${description}\``)
        logNameAndDescription(symbol.children || [], level + 1);
    }
}

function logClientTree(symbols: DocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  " 
        console.log("      ".repeat(level) + `${logIcon}${symbol.name}`);
        logClientTree(symbol.children || [], level + 2);
    }
}


describe("document-symbols tests", () => {
    it("simple function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/func_abc.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(doc.uri, root);
        //debugOutput('simple function symbols', symbols, {off: true})
        //const length = flattenFishDocumentSymbols(symbols).length
        //expect(length).toEqual(6);
    });

    it("advanced function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/multiple_functions.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(doc.uri, root);
        //debugOutput('advanced function symbols', symbols, {off: true, showTree: false})
        //const length = flattenFishDocumentSymbols(symbols).length
        //expect(length).toBeGreaterThan(8);
    });

    it("advanced nested-function symbols single per-scope", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/inner_functions.fish");
        const root = parser.parse(doc.getText()).rootNode
        let symbols = getFishDocumentSymbols(doc.uri, root);
        const result = filterLastFishDocumentSymbols(symbols)
        debugOutput('advanced inner-function symbols single per-scope', result, {off: false, showTree: true})
        //const length = flattenFishDocumentSymbols(result).length
        //expect(length).toEqual(13)
    });

    it("simple test option tags", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/all_variable_def_types.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(doc.uri, root);
        const result = filterLastFishDocumentSymbols(symbols)
        //debugOutput('simple test option tags',result, {off: false, showTree: false})
        //const length = flattenFishDocumentSymbols(result).length
        //expect(length).toEqual(9)
    })

    it("testing variables", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/all_variable_def_types.fish");
        const root = parser.parse(doc.getText()).rootNode
        //const children = getChildNodes(root).filter(n => isVariableDefinitionName(n))
        //for (const node of children) {
        //    const parent = refinedFindParentVariableDefinitionKeyword(node)
        //    if (!parent) continue;
        //    console.log('----------------------');
        //    console.log(`parent: ${parent.text}`);
        //    console.log(`node: ${node.text}`);
        //}
        const allSymbols = getFishDocumentSymbols(doc.uri, root)
        const symbols = filterLastFishDocumentSymbols(allSymbols)
        //debugOutput('testing variables', symbols, {off: true, showTree: true})
        //for (const symbol of symbols) {
            //const node = getNodeAtRange(root, symbol.selectionRange)
            //const parent = getNodeAtRange(root, symbol.range)
            //if (node && !isVariableDefinitionName(node)) {
                //continue;
            //}
            //if (node && parent) {
                //console.log('---------------------------------------------');
                //console.log(`parent: ${parent.text}`);
                //console.log(`node: ${node.text}`);
                //const k = refinedFindParentVariableDefinitionKeyword(node)
                //if (!k) continue;
                //console.log(`keyword: ${k?.text}`);
                ////console.log(k?.toString());
                ////logNode(k)
                ////const def = isVariableDefinitionName(node)
            //}
        //}
        //console.log('---------------------------------------------');
        //console.log(root.text);

    })


})
