"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const completion_1 = require("./completion");
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const handleInitialized_1 = require("./handlers/handleInitialized");
const initializeHandler_1 = require("./handlers/initializeHandler");
const completeHandler_1 = require("./handlers/completeHandler");
const handleDidChange_1 = require("./handlers/handleDidChange");
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
function register(cliOptions) {
    const { connection, documents } = context;
    // store handlers to refrences 
    const handleInitialize = (0, initializeHandler_1.getInitializeHandler)(context);
    const handleInitialized = (0, handleInitialized_1.getInitializedHandler)(context);
    const handleCompletion = (0, completeHandler_1.getCompletionHandler)(context);
    //const handleCompletionResolver = getCompletionResolveHandler(context);
    const handleDidChangeContent = (0, handleDidChange_1.getDidChangeContentHandler)(context);
    // attach handlers by refrence
    connection.onInitialize(handleInitialize);
    connection.onInitialized(handleInitialized);
    connection.onCompletion(handleCompletion);
    //connection.onCompletionResolve(handleCompletionResolver);
    documents.onDidOpen(handleDidChangeContent);
    documents.onDidChangeContent(handleDidChangeContent);
    //context.connection.window.showWarningMessage("hello world")
}
/**
 * run the server
 *
 * @param {CliOptions} [cliOptions] - --noIndex, --stdout, --node-rpc
 */
function main(cliOptions) {
    const { connection, documents } = context;
    if (cliOptions)
        context.cliOptions;
    register(cliOptions);
    documents.listen(connection);
    connection.listen();
}
exports.main = main;
if (require.main === module)
    main();
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