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
const locations_1 = require("./utils/locations");
const completion_1 = require("./completion");
const io_1 = require("./utils/io");
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
//import {getInitializedHandler} from './handlers/handleInitialized';
//import {getInitializeHandler} from './handlers/initializeHandler';
//import {getCompletionHandler} from './handlers/completeHandler';
//import {getCompletionResolveHandler} from './handlers/completeResolveHandler';
//import {getDidChangeContentHandler} from './handlers/handleDidChange';
// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
// Create a simple text document manager. The text document manager
// supports full document sync only
const context = {
    capabilities: {},
    connection: require.main === module
        ? (0, node_1.createConnection)(node_1.ProposedFeatures.all)
        : (0, node_1.createConnection)(process.stdin, process.stdout),
    parser: {},
    documents: new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument),
    completion: new completion_1.Completion(),
    analyzer: {},
    trees: {}
};
class FishServer {
    constructor(context) {
        this.context = context;
        this.console = this.context.connection.console;
    }
    static initialize(connection, { capabilities }) {
        return __awaiter(this, void 0, void 0, function* () {
            context.connection = connection;
            context.parser = yield (0, parser_1.initializeParser)();
            context.analyzer = new analyze_1.Analyzer(context.parser);
            context.documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
            context.completion = new completion_1.Completion();
            context.capabilities = capabilities;
            const files = yield (0, locations_1.getAllFishLocations)();
            try {
                yield context.completion.initialDefaults();
            }
            catch (err) {
                console.log('error!!!!!!!!!!!!!!!');
            }
            for (const uri of files) {
                const file = yield (0, io_1.createTextDocumentFromFilePath)(new URL(uri));
                if (file)
                    yield context.analyzer.initialize(context, file);
            }
            return new FishServer(context);
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
            //documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            referencesProvider: true,
        };
    }
    register(connection) {
        //const opened = this.documents.getOpenDocuments();
        //connection.listen(connection);
        //connection.dispose()
        //let languageModes: any;
        //connection.onInitialize((_params: InitializeParams) => {
        //    languageModes = languageModes();
        //    documents.onDidClose(e => {
        //        languageModes.onDocumentRemoved(e.document);
        //    });
        //    connection.onShutdown(() => {
        //        languageModes.dispose();
        //    });
        //    return {
        //        capabilities: this.capabilities()
        //    };
        //});
        connection.onDidOpenTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = this.context.documents.get(uri);
            if (doc) {
                yield this.context.analyzer.initialize(this.context, doc);
            }
            //this.logger.logmsg({action:'onOpen', path: uri})
        }));
        connection.onDidChangeTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            let doc = this.context.documents.get(uri);
            if (document && this.context.documents.get(uri) !== undefined && doc) {
                yield this.context.analyzer.initialize(this.context, doc);
                yield this.context.analyzer.analyze(this.context, doc);
            }
        }));
        connection.onDidCloseTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const uri = change.textDocument.uri;
        }));
        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        connection.onCompletion(this.onCompletion.bind(this));
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
        this.context.documents.listen(connection);
        this.context.connection.listen();
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
            //const pos: Position = {
            //    line: position.line,
            //    character: Math.max(0, position.character-1)
            //}
            //if (documentText.endsWith('-')) {
            //    return null;
            //}
            let doc = this.context.documents.get(uri);
            if (doc) {
                yield this.context.analyzer.initialize(this.context, doc);
                yield this.context.analyzer.analyze(this.context, doc);
            }
            const node = this.context.analyzer.nodeAtPoint(this.context.trees[uri], position.line, position.character);
            //this.logger.logmsg({ path: uri, action:'onComplete', node: node})
            if (!node)
                return null;
            try {
                const completionList = yield this.context.completion.generate(node);
                if (completionList)
                    return completionList;
            }
            catch (error) {
                this.console.log(`ERROR: ${error}`);
            }
            this.console.log(`ERROR: onCompletion !Error`);
            return null;
            //const commandNode: SyntaxNode | null = findParentCommand(node);
            //if (!commandNode) {
            //    //use node
            //}
            //this.analyzer.getHoverFallback(uri, node)
            //// build Completions
            //const completions: CompletionItem[] = []
            //return completions
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