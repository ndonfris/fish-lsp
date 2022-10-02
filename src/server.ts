import Parser, { SyntaxNode } from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
import { initializeParser } from "./parser";
//import { MyAnalyzer } from "./analyse";
import { Analyzer } from "./analyze";
import { getAllFishLocations } from "./utils/locations";
import { Logger } from "./logger";
import { Completion } from "./completion";
import { createTextDocumentFromFilePath } from "./utils/io";

import {
    ClientCapabilities,
    createConnection,
    InitializeParams,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {CliOptions, Context, TreeByUri} from './interfaces';
import {getInitializedHandler} from './handlers/handleInitialized';
import {getInitializeHandler} from './handlers/initializeHandler';
import {getCompletionHandler} from './handlers/completeHandler';
import {getCompletionResolveHandler} from './handlers/completeResolveHandler';
import {getDidChangeContentHandler} from './handlers/handleDidChange';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.

// Create a simple text document manager. The text document manager
// supports full document sync only

const context: Context = {
    capabilities: {} as ClientCapabilities,
    connection: require.main === module
      ? createConnection(ProposedFeatures.all)
      : createConnection(process.stdin, process.stdout),
    parser: {} as Parser,
    documents: new TextDocuments(TextDocument),
    completion: new Completion(),
    analyzer: {} as Analyzer,
    trees: {} as TreeByUri
}

function register(cliOptions?: CliOptions) {
    const { connection, documents } = context;
    

    // store handlers to refrences 
    const handleInitialize = getInitializeHandler(context);
    const handleInitialized = getInitializedHandler(context);

    const handleCompletion = getCompletionHandler(context);
    //const handleCompletionResolver = getCompletionResolveHandler(context);
                                                       
    const handleDidChangeContent = getDidChangeContentHandler(context);

    // attach handlers by refrence
    connection.onInitialize(handleInitialize);
    connection.onInitialized(handleInitialized);
    connection.onCompletion(handleCompletion);
    //connection.onCompletionResolve(handleCompletionResolver);

    documents.onDidOpen(handleDidChangeContent)
    documents.onDidChangeContent(handleDidChangeContent);
    //context.connection.window.showWarningMessage("hello world")

}




/**
 * run the server 
 *
 * @param {CliOptions} [cliOptions] - --noIndex, --stdout, --node-rpc
 */
export function main(cliOptions?: CliOptions) { 
    const { connection, documents } = context;

    if (cliOptions) context.cliOptions

    register(cliOptions)

    documents.listen(connection)
    connection.listen()
}

if (require.main === module) main()


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
