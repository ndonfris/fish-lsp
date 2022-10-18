"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
const parser_1 = require("./parser");
//import { MyAnalyzer } from "./analyse";
const analyze_1 = require("./analyze");
const completion_1 = require("./completion");
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const document_1 = require("./document");
const completion_types_1 = require("./utils/completion-types");
class FishServer {
    constructor(connection, parser, analyzer, docs, completion) {
        this.connection = connection;
        this.console = this.connection.console;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.completion = completion;
    }
    static initialize(connection, { capabilities }) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = yield (0, parser_1.initializeParser)();
            return Promise.all([
                new analyze_1.Analyzer(parser),
                document_1.DocumentManager.indexUserConfig(connection.console),
                completion_1.Completion.initialDefaults(),
            ]).then(([analyzer, docs, completion]) => new FishServer(connection, parser, analyzer, docs, completion));
        });
    }
    capabilities() {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: node_1.TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ["$", "-"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            //documentSymbolProvider: true,
            //workspaceSymbolProvider: true,
            //referencesProvider: true,
        };
    }
    register() {
        this.docs.documents.listen(this.connection);
        this.connection.onDidOpenTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            this.console.log('[connection.onDidOpenTextDocument] ' + document.uri);
            const uri = document.uri;
            let doc = yield this.docs.openOrFind(uri);
            this.analyzer.analyze(doc);
            //this.logger.logmsg({action:'onOpen', path: uri})
        }));
        this.connection.onDidChangeTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            //this.console.log('[connection.onDidChangeTextDocument] '+ uri)
            let doc = yield this.docs.openOrFind(uri);
            //this.console.log(doc.getText())
            this.console.log('[connection.onDidChangeTextDocument] ' + doc.uri);
            doc = vscode_languageserver_textdocument_1.TextDocument.update(doc, change.contentChanges, document.version + 1);
            //this.console.log(doc.getText())
            this.analyzer.analyze(doc);
            const root = this.analyzer.getRoot(doc);
            //for (const n of getChildNodes(root)) {
            //    try {
            //        isLocalVariable(n, this.console)
            //        this.console.log(`localNode: ${getNodeText(n) || ""}`);
            //    } catch (err) {
            //        this.console.log("ERROR: " + n.text)
            //    }
            //}
        }));
        this.connection.onDidCloseTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const uri = change.textDocument.uri;
            this.docs.close(uri);
        }));
        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        this.connection.onCompletion(this.onCompletion.bind(this));
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
        this.docs.documents.onDidChangeContent((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.document;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            let doc = yield this.docs.openOrFind(uri);
            this.console.log('documents.onDidChangeContent: ' + doc.uri);
            //this.console.log(doc.getText())
            //doc = TextDocument.update(change.document, change.document., document.version+1)
            //console.log(doc.getText())
            this.analyzer.analyze(doc);
        }));
    }
    onCompletion(completionParams) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = completionParams.textDocument.uri;
            const position = completionParams.position;
            this.console.log('onComplete' + uri);
            //if (documentText.endsWith('-')) {
            //    return null;
            //}
            const doc = yield this.docs.openOrFind(uri);
            //this.console.log('onComplete() doc.uri = ' + doc.uri)
            this.analyzer.analyze(doc);
            const node = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);
            //this.console.log('[connection.onCompletion()] -> analyzer.nodeAtPoint' + getNodeText(node))
            const line = this.analyzer.currentLine(doc, completionParams.position) || "";
            const r = (0, document_1.getRangeFromPosition)(completionParams.position);
            //this.console.log(`[onComplete(${position.line}, ${position.character})] LINE -> ${line}; RANGE -> {\n\tstart: (${r.start.line}, ${r.start.character}),\n\t end: (${r.end.line}, ${r.end.character})\n}`)
            if (line !== "") {
                return yield this.completion.generateLineCmpNew(line);
                //await this.completion.generateLineCompletion(line)
            }
            if (!node)
                return this.completion.fallbackComplete();
            const completionList = yield this.completion.generate(node);
            if (completionList) {
                return completionList;
            }
            return this.completion.fallbackComplete();
        });
    }
    onCompletionResolve(item) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            //import
            let newItem = item;
            const fishItem = item;
            try {
                newItem = yield (0, completion_types_1.handleCompletionResolver)(item, this.console);
                this.console.log(`
                { ${fishItem.label}, 
                    ${fishItem.documentation}, 
                    ${(_a = fishItem.data) === null || _a === void 0 ? void 0 : _a.originalCompletion}
                  ${fishItem.kind}, 
                }
            `);
            }
            catch (err) {
                this.console.log("ERRRRRRRRRRRRROOOOORRRR" + err);
                return item;
            }
            return newItem;
        });
    }
}
exports.default = FishServer;
//function register(cliOptions?: CliOptions) {
//    const { connection, documents } = context;
//    
//
//    // store handlers to refrences 
//    const handleInitialize = getInitializeHandler(context);
//    const handleInitialized = getInitializedHandler(context);
//
//    const handleDidChangeContent = getDidChangeContentHandler(context);
//    const handleCompletionResolver = getCompletionResolveHandler(context);
//                                                       
//
//    // attach handlers by refrence
//    connection.onInitialize(handleInitialize);
//    context.connection.onInitialized(handleInitialized);
//
//    //context.connection.window.showWarningMessage("hello world")
//}
//
//
//
//
///**
// * run the server 
// *
// * @param {CliOptions} [cliOptions] - --noIndex, --stdout, --node-rpc
// */
//export function main(cliOptions?: CliOptions) { 
//    const { connection, documents } = context;
//
//    if (cliOptions) context.cliOptions
//
//    register(cliOptions)
//
//    context.documents.onDidChangeContent( async change => {
//        context.connection.console.error('handleDidChangeContent()')
//        const uri = change.document.uri; 
//        context.connection.console.error(`handleDidChangeContent(): ${uri}`)
//        const doc = context.documents.get(uri);
//        if (doc) {
//            context.analyzer.analyze(context, doc);
//        } else {
//            const newDoc = await createTextDocumentFromFilePath(context, new URL(change.document.uri))
//            if (newDoc) await context.analyzer.initialize(context, newDoc);
//            return null
//        }
//    })
//    context.connection.languages.connection.onCompletion((params: CompletionParams) => {
//        context.connection.console.log(`completion: ${params}`)
//        return null
//    });
//
//    context.documents.listen(connection)
//    context.connection.listen()
//}
//
//if (require.main === module) main()
//context.connection.onInitialize((_params: InitializeParams) => {
//    
//    return {
//        capabilities: {
//            textDocumentSync: TextDocumentSyncKind.Full,
//            // Tell the client that the server supports code completion
//            completionProvider: {
//                resolveProvider: false,
//            },
//        },
//    };
//});
//
//
//
//
//
//connection.onCompletion(async (textDocumentPosition, token) => {
//    const document = documents.get(textDocumentPosition.textDocument.uri);
//    if (!document) {
//        return null;
//    }
//});
//
//documents.listen(connection);
//connection.listen();
//# sourceMappingURL=server.js.map