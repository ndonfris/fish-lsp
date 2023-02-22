
import Parser from 'web-tree-sitter';
import { FishDocumentSymbol, getFishDocumentSymbols } from '../src/document-symbol'
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
        detail: `${symbol.detail.toString()}`,
        kind: symbolKindToString(symbol.kind),
        range: `${symbol.range.start.line}:${symbol.range.start.character} - ${symbol.range.end.line}:${symbol.range.end.character}`,
        selectionRange: `${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character} - ${symbol.selectionRange.end.line}:${symbol.selectionRange.end.character}`,
        children: symbol.children.map(c => JSON.parse(documentSymbolString(c, indent + 2)))
    }, null, 2).split('\n').map(line => indentStr + line).join('\n');
}

const printDocumentSymbol = (symbol: FishDocumentSymbol, indent: number = 0) => {
    console.log(documentSymbolString(symbol, indent));
}

describe("document-symbols tests", () => {
    it("simple function symbols", async () => {
        const doc = resolveLspDocumentForHelperTestFile("./fish_files/simple/func_abc.fish");
        const root = parser.parse(doc.getText()).rootNode
        const symbols = getFishDocumentSymbols(root, doc.uri);
        symbols.forEach(s => {
            printDocumentSymbol(s)
        })
    });
})

