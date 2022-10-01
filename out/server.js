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
const vscode_languageserver_1 = require("vscode-languageserver");
const LSP = __importStar(require("vscode-languageserver"));
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
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
const documents = new vscode_languageserver_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
/**
 * The FishServer glues together the separate components to implement
 * the various parts of the Language Server Protocol.
 */
class FishServer {
    constructor(connection, parser, 
    //documents: LspDocuments,
    analyzer, completion, capabilities) {
        this.connection = connection;
        this.logger = new logger_1.Logger(this.connection);
        //this.documents = documents;
        this.parser = parser;
        this.analyzer = analyzer;
        this.completion = completion;
        this.clientCapabilities = capabilities;
    }
    /**
     * Initialize the server based on a connection to the client and the protocols
     * initialization parameters.
     */
    static initialize(connection, { capabilities }) {
        return __awaiter(this, void 0, void 0, function* () {
            const parser = yield (0, parser_1.initializeParser)();
            const analyzer = new analyze_1.MyAnalyzer(parser);
            //const documents = new LspDocuments(new TextDocuments(TextDocument));
            //const files = await getAllFishLocations();
            //for (const uri of files) {
            //    const file = await createTextDocumentFromFilePath(uri)
            //    if (file) await analyzer.initialize(uri, file)
            //}
            const completion = new completion_1.Completion();
            try {
                yield completion.initialDefaults();
            }
            catch (err) {
                console.log('error!!!!!!!!!!!!!!!');
            }
            // for (const file of files) {
            //     //const doc =  await createTextDocumentFromFilePath(file)
            //     //await analyzer.initialize(file)
            //     //if (!doc) continue;
            //     //await analyzer.analyze(file, doc)
            //     //const newRefrences = analyzer.uriToSyntaxTree[uri]?.getUniqueCommands()!
            //     //newRefrences.forEach(refrence => {
            //     //})
            // }
            return new FishServer(connection, parser, 
            //documents,
            analyzer, 
            //dependencies,
            completion, capabilities);
        });
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
        //connection.onInitialize(async )
        connection.onDidOpenTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            yield this.analyzer.initialize(uri);
            this.logger.logmsg({ action: 'onOpen', path: uri });
        }));
        connection.onDidChangeTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            this.logger.logmsg({ path: uri, action: 'onDidChangeContent' });
            let doc = documents.get(uri);
            if (document && documents.get(uri) !== undefined) {
                doc = yield this.analyzer.initialize(uri);
            }
            yield this.analyzer.analyze(uri, doc);
        }));
        connection.onDidCloseTextDocument((change) => __awaiter(this, void 0, void 0, function* () {
            const uri = change.textDocument.uri;
            this.logger.logmsg({ path: uri, action: 'onDidClose' });
        }));
        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        connection.onHover(this.onHover.bind(this));
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        connection.onCompletion(this.onCompletion.bind(this));
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
        documents.listen(connection);
        //connection.listen()
    }
    capabilities() {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: LSP.TextDocumentSyncKind.Full,
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
    onHover(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = params.textDocument.uri;
            const node = this.analyzer.nodeAtPoint(params.textDocument.uri, params.position.line, params.position.character);
            //const doc = this.documents.get(uri)
            //if (doc) {
            //    this.analyzer.analyze(uri, doc)
            //}
            this.logger.logmsg({ path: uri, action: 'onHover', params: params, node: node });
            if (!node)
                return null;
            let hoverDoc = this.analyzer.nodeIsLocal(uri, node) || (yield this.analyzer.getHover(params));
            // TODO: heres where you should use fallback completion, and argument .
            if (hoverDoc) {
                return hoverDoc;
            }
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
    onCompletion(completionParams) {
        return __awaiter(this, void 0, void 0, function* () {
            const uri = completionParams.textDocument.uri;
            const position = completionParams.position;
            const currText = resolveCurrentDocumentLine(uri, position, this.logger);
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
            let document = documents.get(uri);
            if (!document) {
                document = yield this.analyzer.initialize(uri);
                yield this.analyzer.analyze(uri, document);
            }
            const node = this.analyzer.nodeAtPoint(uri, position.line, position.character);
            this.logger.logmsg({ path: uri, action: 'onComplete', node: node });
            if (!node)
                return null;
            try {
                const completionList = yield this.completion.generate(node);
                if (completionList)
                    return completionList;
            }
            catch (error) {
                this.logger.log(`ERROR: ${error}`);
            }
            this.logger.log(`ERROR: onCompletion !Error`);
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
    onCompleteResolve(item) {
        return __awaiter(this, void 0, void 0, function* () {
            return item;
        });
    }
}
exports.default = FishServer;
function resolveCurrentDocumentLine(uri, currPos, logger) {
    const currDoc = documents.get(uri);
    if (currDoc === undefined)
        return "";
    const currText = currDoc.getText().split('\n').at(currPos.line);
    logger.log('currText: ' + currText);
    return currText || "";
}
//# sourceMappingURL=server.js.map