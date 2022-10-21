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
const filepathResolver_1 = require("./utils/filepathResolver");
const completionBuilder_1 = require("./utils/completionBuilder");
const documentation_1 = require("./documentation");
const exec_1 = require("./utils/exec");
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
            const filepaths = filepathResolver_1.FilepathResolver.create();
            return Promise.all([
                new analyze_1.Analyzer(parser),
                document_1.DocumentManager.indexUserConfig(connection.console),
                completion_1.Completion.initialDefaults(filepaths),
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
            logger_1.logger.log(doc.getText());
            this.analyzer.analyze(doc);
        }));
    }
    onCompletion(completionParams) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const uri = completionParams.textDocument.uri;
            const position = completionParams.position;
            logger_1.logger.log('server.onComplete' + uri);
            const doc = yield this.docs.openOrFind(uri);
            const node = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);
            if (node) {
                logger_1.logger.log(`node: ${(_a = node.parent) === null || _a === void 0 ? void 0 : _a.text}`);
            }
            //const r = getRangeFromPosition(completionParams.position);
            this.connection.console.log('on complete node: ' + doc.uri || "");
            const line = this.analyzer.currentLine(doc, completionParams.position) || " ";
            //if (line.startsWith("\#")) {
            //    return null;
            //}
            const items = [];
            try {
                logger_1.logger.log('line' + line);
                //const newLine = line.trimStart().split(' ')
                const output = yield (0, completion_1.getShellCompletions)(line.trimStart());
                //output.forEach(([label, keyword, otherInfo]) => {
                //    logger.log(`label: '${label}'\nkeyword: '${keyword}'\notherInfo: '${otherInfo}'`)
                //});
                const cmp = new completionBuilder_1.CompletionItemBuilder();
                if (output.length == 0) {
                    return null;
                }
                for (const [label, desc, other] of output) {
                    const fishKind = (0, completionBuilder_1.parseLineForType)(label, desc, other);
                    //logger.log(`fishKind: ${fishKind}`)
                    if (label === 'gt') {
                        logger_1.logger.log(`label: '${label}'\nkeyword: '${desc}'\notherInfo: '${other}'\n type: ${fishKind}`);
                    }
                    const item = cmp.create(label)
                        .documentation([desc, other].join(' '))
                        .kind(fishKind)
                        .originalCompletion([label, desc].join('\t') + ' ' + other)
                        .build();
                    items.push(item);
                    //logger.log(`label_if:  ${isBuiltIn(label)}`)
                    cmp.reset();
                }
            }
            catch (e) {
                this.connection.console.log("error" + e);
                this.connection.console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
                this.connection.console.log(doc.getText());
                this.connection.console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            }
            return node_1.CompletionList.create(items, false);
        });
    }
    onCompletionResolve(item) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            const fishItem = item;
            //const fishItem = item as FishCompletionItem;
            //try {
            //    //logger.log('server onCompletionResolve:', {extraInfo: ['beforeResolve:' ], completion: item})
            //    //newItem = await handleCompletionResolver(item as FishCompletionItem, this.console)
            //    let newDoc : string | MarkupContent;
            //    const fishKind = fishItem.data?.fishKind;
            //    console.log('handleCmpResolver ' + fishKind)
            //    switch (fishKind) {
            //        case FishCompletionItemKind.ABBR:              // interface
            //        case FishCompletionItemKind.ALIAS:             // interface
            //            fishItem.documentation = enrichToCodeBlockMarkdown(fishItem.documentation as string)
            //            break;
            //        case FishCompletionItemKind.BUILTIN:           // keyword
            //            newDoc = await execCommandDocs(fishItem.label)
            //            fishItem.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
            //            break;
            //        case FishCompletionItemKind.LOCAL_VAR:         // variable
            //        case FishCompletionItemKind.GLOBAL_VAR:        // variable
            //            fishItem.documentation = enrichToMarkdown(`__${fishItem.label}__ ${fishItem.documentation}`)
            //            break;
            //        case FishCompletionItemKind.LOCAL_FUNC:        // function
            //        case FishCompletionItemKind.GLOBAL_FUNC:       // function
            //            newDoc = await execCommandDocs(fishItem.label)
            //            if (newDoc) {
            //                fishItem.documentation = newDoc;
            //            }
            //            break;
            //        case FishCompletionItemKind.FLAG:              // field
            //            fishItem.documentation = enrichToMarkdown(`__${fishItem.label}__ ${fishItem.documentation}`)
            //            break;
            //        case FishCompletionItemKind.CMD_NO_DOC:        // refrence
            //            break;
            //        case FishCompletionItemKind.CMD:               // module
            //            newDoc = await execCommandDocs(fishItem.label)
            //            if (newDoc) {
            //                fishItem.documentation = newDoc;
            //            }
            //        case FishCompletionItemKind.RESOLVE:           // method -> module or function
            //            newDoc = await execCommandDocs(fishItem.label)
            //            fishItem.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
            //            break;
            //        default:
            //            return fishItem;
            //    }            //logger.log('server onCompletionResolve:', {extraInfo: ['AfterResolve:' ], completion: item})
            //} catch (err) {
            //    logger.log("ERRRRRRRRRRRRROOOOORRRR " + err)
            //    return fishItem;
            //
            let newDoc;
            let typeCmdOutput = '';
            let typeofDoc = '';
            switch (fishItem.kind) {
                case node_1.CompletionItemKind.Constant:
                    item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)((_a = fishItem.data) === null || _a === void 0 ? void 0 : _a.originalCompletion, 'fish');
                case node_1.CompletionItemKind.Variable:
                    item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)((_b = fishItem.data) === null || _b === void 0 ? void 0 : _b.originalCompletion, 'fish');
                case node_1.CompletionItemKind.Interface:
                    item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)((_c = fishItem.data) === null || _c === void 0 ? void 0 : _c.originalCompletion, 'fish');
                case node_1.CompletionItemKind.Function:
                    newDoc = yield (0, exec_1.execCommandDocs)(fishItem.label);
                    item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'fish');
                    return item;
                case node_1.CompletionItemKind.Unit:
                    typeCmdOutput = yield (0, exec_1.execCommandType)(fishItem.label);
                    if (typeCmdOutput != '') {
                        newDoc = yield (0, exec_1.execCommandDocs)(fishItem.label);
                        item.documentation = typeCmdOutput === 'file'
                            ? (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'fish') : (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'man');
                    }
                    return item;
                case node_1.CompletionItemKind.Class:
                case node_1.CompletionItemKind.Method:
                case node_1.CompletionItemKind.Keyword:
                    newDoc = yield (0, exec_1.execCommandDocs)(fishItem.label);
                    item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'man');
                    return item;
                default:
                    return item;
            }
        });
    }
}
exports.default = FishServer;
//# sourceMappingURL=server.js.map