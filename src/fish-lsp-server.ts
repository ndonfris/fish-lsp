import Parser, { SyntaxNode } from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
import { initializeParser } from "./parser";
//import { MyAnalyzer } from "./analyse";
import { MyAnalyzer } from "./analyze";
import { getAllFishLocations } from "./utils/locations";
import { Logger } from "./logger";
import { Completion } from "./completion";
import { createTextDocumentFromFilePath } from "./utils/io";

import { createConnection, InitializeParams, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams) => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: false
			}
		}
	};
});

connection.onCompletion(async (textDocumentPosition, token) => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document) {
        return null;
    }

});

documents.listen(connection);
connection.listen();
