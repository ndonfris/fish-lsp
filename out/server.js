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
const logger_1 = require("./logger");
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
            logger_1.logger.setConsole(connection.console);
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
        this.connection.onDidOpenTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = yield this.docs.openOrFind(uri);
            this.analyzer.analyze(doc);
            logger_1.logger.log(this.connection.onDidOpenTextDocument.name, { document: doc });
        }));
        this.connection.onDidChangeTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const uri = change.textDocument.uri;
            let doc = yield this.docs.openOrFind(uri);
            logger_1.logger.log(this.connection.onDidChangeTextDocument.name, { extraInfo: [doc.uri, '\nchanges:', ...change.contentChanges.map(c => c.text)] });
            doc = vscode_languageserver_textdocument_1.TextDocument.update(doc, change.contentChanges, change.textDocument.version);
            this.analyzer.analyze(doc);
            const root = this.analyzer.getRoot(doc);
            // do More stuff
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
            let doc = yield this.docs.openOrFind(uri);
            logger_1.logger.log('documents.onDidChangeContent: ' + doc.uri);
            this.analyzer.analyze(doc);
        }));
        this.docs.documents.listen(this.connection);
    }
    onCompletion(completionParams) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = completionParams.textDocument.uri;
            const position = completionParams.position;
            logger_1.logger.log('server.onComplete' + uri, { caller: this.onCompletion.name, position: completionParams.position });
            const doc = yield this.docs.openOrFind(uri);
            const node = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);
            //const r = getRangeFromPosition(completionParams.position);
            logger_1.logger.log('on complete node', { caller: this.onCompletion.name, rootNode: node || undefined, position: completionParams.position });
            const line = this.analyzer.currentLine(doc, completionParams.position) || "";
            //if (line.startsWith("\#")) {
            //    return null;
            //}
            yield this.completion.generateLineCmpNew(line);
            return this.completion.fallbackComplete();
        });
    }
    onCompletionResolve(item) {
        return __awaiter(this, void 0, void 0, function* () {
            let newItem = item;
            const fishItem = item;
            try {
                logger_1.logger.log('server onCompletionResolve:', { extraInfo: ['beforeResolve:'], completion: item });
                newItem = yield (0, completion_types_1.handleCompletionResolver)(item, this.console);
                logger_1.logger.log('server onCompletionResolve:', { extraInfo: ['AfterResolve:'], completion: item });
            }
            catch (err) {
                logger_1.logger.log("ERRRRRRRRRRRRROOOOORRRR " + err);
                return item;
            }
            return newItem;
        });
    }
}
exports.default = FishServer;
//# sourceMappingURL=server.js.map