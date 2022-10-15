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
const document_1 = require("./document");
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
            //const connection = connection;
            const parser = yield (0, parser_1.initializeParser)();
            const analyzer = new analyze_1.Analyzer(parser, connection.console);
            const docs = yield document_1.DocumentManager.indexUserConfig(connection.console);
            const completion = yield completion_1.Completion.initialDefaults();
            return new FishServer(connection, parser, analyzer, docs, completion);
        });
    }
    capabilities() {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: node_1.TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ["$", "-"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            referencesProvider: true,
        };
    }
    register() {
        this.connection.onDidOpenTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = yield this.docs.openOrFind(uri);
            yield this.analyzer.analyze(doc);
            this.console.log('onDidOpenTextDocument: ' + doc.uri);
            //this.logger.logmsg({action:'onOpen', path: uri})
        }));
        this.connection.onDidChangeTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            const doc = yield this.docs.openOrFind(uri);
            this.console.log('onDidChangeText' + doc.uri);
            yield this.analyzer.analyze(doc);
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
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
        this.docs.documents.listen(this.connection);
    }
    onCompletion(completionParams) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = completionParams.textDocument.uri;
            const position = completionParams.position;
            //if (currDoc) {
            //const currPos = currDoc.offsetAt(position)
            //const range: Range = Range.create({line: position.line, character: 0}, {line: position.line, character: position.character})
            //const documentText = this.analyzer.uriToTextDocument[uri].toString()
            //this.logger.log(`cmpDocText: ${documentText}`)
            //}
            this.console.log('onComplete' + uri);
            //const pos: Position = {
            //    line: position.line,
            //    character: Math.max(0, position.character-1)
            //}
            //if (documentText.endsWith('-')) {
            //    return null;
            //}
            const doc = yield this.docs.openOrFind(uri);
            this.console.log('onComplete() doc.uri = ' + doc.uri);
            yield this.analyzer.analyze(doc);
            const node = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);
            //console.log('onComplete() -> analyzer.nodeAtPoint' + getNodeText(node))
            //this.logger.logmsg({ path: uri, action:'onComplete', node: node})
            if (!node)
                return this.completion.fallbackComplete();
            const completionList = yield this.completion.generate(node);
            if (completionList) {
                return completionList;
            }
            //this.console.log('ERROR: onCompletion !Error')
            //const commandNode: SyntaxNode | null = findParentCommand(node);
            //if (!commandNode) {
            //    //use node
            //}
            //this.analyzer.getHoverFallback(uri, node)
            //// build Completions
            //const completions: CompletionItem[] = []
            //return completions
            return this.completion.fallbackComplete();
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