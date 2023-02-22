
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { getFishDocumentSymbols, filterLastFishDocumentSymbols, FishDocumentSymbol, flattenFishDocumentSymbols,} from '../src/document-symbol'
import { initializeParser } from '../src/parser';
import { symbolKindToString } from '../src/symbols';
import { resolveLspDocumentForHelperTestFile } from './helpers';

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


function debugOutput(symbols: FishDocumentSymbol[], options?: {showTree?: boolean, showAllSymbols?: boolean, showNamesAndDescriptions?: boolean, showArray?: boolean}){
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
        logClientTree(symbol.children || [], level + 1);
    }
}


describe("document-symbols tests", () => {
    it("simple function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/func_abc.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(doc.uri, root);
        //console.log();
        //console.log('simple function symbols');
        //debugOutput(symbols, {})
        const length = flattenFishDocumentSymbols(symbols).length
        expect(length).toEqual(6);
    });

    it("advanced function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/multiple_functions.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(doc.uri, root);
        //console.log();
        //console.log('advanced function symbols');
        //debugOutput(symbols, {showTree: true})
        const length = flattenFishDocumentSymbols(symbols).length
        expect(length).toBeGreaterThan(8);
    });

    it("advanced nested-function symbols single per-scope", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/advanced/inner_functions.fish");
        const root = parser.parse(doc.getText()).rootNode
        let symbols = getFishDocumentSymbols(doc.uri, root);
        const result = filterLastFishDocumentSymbols(symbols)
        //console.log();
        //console.log('advanced inner-function symbols single per-scope');
        //debugOutput(result, {showTree: true})
        const length = flattenFishDocumentSymbols(result).length
        expect(length).toEqual(13)
    });

    it("simple test option tags", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/all_variable_def_types.fish");
        const root = parser.parse(doc.getText()).rootNode
        let symbols = getFishDocumentSymbols(doc.uri, root);
        const result = filterLastFishDocumentSymbols(symbols)
        console.log();
        console.log('simple test option tags');
        debugOutput(result, {showAllSymbols: true})
        //const length = flattenFishDocumentSymbols(result).length
    })

})
