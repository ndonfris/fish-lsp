"use strict";
/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const node_1 = require("vscode-languageserver/node");
const LSP = __importStar(require("vscode-languageserver/node"));
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
const document_1 = require("./document");
const parser_1 = require("./parser");
const analyse_1 = require("./analyse");
const locations_1 = require("./utils/locations");
const node_types_1 = require("./utils/node-types");
const logger_1 = require("./logger");
/**
 * The FishServer glues together the separate components to implement
 * the various parts of the Language Server Protocol.
 */
class FishServer {
    constructor(connection, parser, documents, analyzer, capabilities) {
        this.connection = connection;
        this.logger = new logger_1.Logger(this.connection);
        this.documents = documents;
        this.parser = parser;
        this.analyzer = analyzer;
        this.clientCapabilities = capabilities;
    }
    /**
     * Initialize the server based on a connection to the client and the protocols
     * initialization parameters.
     */
    static initialize(connection, { capabilities }) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = yield (0, parser_1.initializeParser)();
            const analyzer = new analyse_1.MyAnalyzer(parser);
            const documents = new document_1.LspDocuments(new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument));
            const files = yield (0, locations_1.getAllFishLocations)();
            for (const file of files) {
                //const doc =  await createTextDocumentFromFilePath(file)
                //if (!doc) continue;
                yield analyzer.initialize(file);
            }
            return new FishServer(connection, parser, documents, analyzer, 
            //dependencies,
            capabilities);
        });
    }
    register(connection) {
        //const opened = this.documents.getOpenDocuments();
        this.documents.listener.listen(connection);
        this.documents.listener.onDidOpen((open) => __awaiter(this, void 0, void 0, function* () {
            const { document } = open;
            const uri = document.uri;
            this.documents.newDocument(uri);
            this.documents.open(uri);
            this.logger.logmsg({ action: 'onOpen', path: uri });
            this.analyzer.analyze(uri, document);
        }));
        this.documents.listener.onDidChangeContent((change) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const { document } = change;
            const uri = document.uri;
            this.documents.newDocument(uri);
            this.logger.logmsg({ path: uri, action: 'onDidClose' });
            const isOpen = yield this.documents.open(uri);
            if (isOpen) {
                this.documents.newDocument(uri);
                const doc = this.documents.get(uri);
                this.analyzer.analyze(uri, doc);
                // dependencies are handled in analyze()
                // push diagnostics
            }
            else {
                // already open (republish diagnostics)
                // check if new command added
                const doc = this.documents.get(uri);
                this.analyzer.analyze(uri, doc);
            }
            (_a = this.analyzer.uriToSyntaxTree[uri]) === null || _a === void 0 ? void 0 : _a.ensureAnalyzed();
        }));
        this.documents.listener.onDidClose((change) => __awaiter(this, void 0, void 0, function* () {
            const { document } = change;
            const uri = document.uri;
            const doc = this.documents.close(uri);
            this.logger.logmsg({ path: uri, action: 'onDidClose' });
            return doc;
        }));
        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        connection.onHover(this.onHover.bind(this));
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        // connection.onCompletion(this.onCompletion.bind(this))
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
    }
    capabilities() {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: LSP.TextDocumentSyncKind.Full,
            //completionProvider: {
            //    resolveProvider: true,
            //    triggerCharacters: ["$", "-"],
            //},
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            //documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            referencesProvider: true,
        };
    }
    onHover(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const node = this.analyzer.nodeAtPoint(params.textDocument.uri, params.position.line, params.position.character);
            //const doc = this.documents.get(uri)
            //if (doc) {
            //    this.analyzer.analyze(uri, doc)
            //}
            if (!node)
                return null;
            this.logger.logmsg({ path: uri, action: 'onHover', params: params, node: node });
            const hoverDoc = this.analyzer.nodeIsLocal(uri, node) || (yield this.analyzer.getHover(params));
            if (hoverDoc) {
                return hoverDoc;
            }
            // TODO: heres where you should use fallback completion, and argument .
            // this.analyzer.getHoverFallback(uri, node)
            this.logger.logmsg({ action: 'onHover', message: 'ERROR', params: params, node: node });
            return null;
            //if (!node) return null
            //const cmd = findParentCommand(node)
            //const cmdText = cmd?.firstChild?.text.toString() || ""
            //if (cmdText == "") return null
            //const text = await execCommandDocs(cmdText)
            //return hoverDoc
            //const hover = this.analyzer.getHover(params)
            //if (!hover) return null
            //return hover
        });
    }
    onComplete(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const node = this.analyzer.nodeAtPoint(uri, params.position.line, params.position.character);
            if (!node)
                return;
            const commandNode = (0, node_types_1.findParentCommand)(node);
            if (!commandNode) {
                //use node
            }
            this.analyzer.getHoverFallback(uri, node);
            // build Completions
            const completions = [];
            return completions;
        });
    }
    onCompleteResolve(item) {
        return __awaiter(this, void 0, void 0, function* () {
            return item;
        });
    }
}
exports.default = FishServer;
//# sourceMappingURL=server.js.map