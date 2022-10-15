import { TextDocument } from 'vscode-languageserver-textdocument';
import { RemoteConsole, TextDocuments } from 'vscode-languageserver';
/**
 *  DO NOT create vscode-uri anywhere outside of DocumentManager. when a document is returned just use the uri on it.
 *  ──────
 *
 * ┌──────────────────┐
 * │  DocumentManager │
 * └──────────────────┘
 *
 *      • initialized via: DocumentManager.indexUserConfig(connection.console)
 *      • method above returns the Singleton DocumentManager.
 *      • listener for documents is accessible via: DocumentManager.documents
 */
export declare class DocumentManager {
    private _documents;
    private openDocuments;
    private allDocuments;
    console: RemoteConsole;
    static indexUserConfig(console: RemoteConsole): Promise<DocumentManager>;
    /**
     * Constructor for a single documentManager per FishServer
     *
     * @param {RemoteConsole} console - the console to log error messages to
     */
    private constructor();
    /**
     * getter accesssible via DocumentManager.documents
     *                        ⟶    new TextDocuments(TextDocument);
     * chain the neccessary handlers to the FishServer.DocumentManager instance
     *                        ⟶    DocumentManager.documents.onContentDidChange( ... => {})
     *
     *  notice:
     *  ──────────────────────┬─────────────────────────────────────
     *  vscode-languageserver │ vscode-languageserver-textdocument
     *                ↓       │     ↓
     * @returns {TextDocuments<TextDocument>} : API Manager for TextDocuments
     */
    get documents(): TextDocuments<TextDocument>;
    /**
     * @async openOrFind(possibleUri) - guarantees a text document will be returned,
     *                                  even if there is an error with the uri. The uri
     *                                  passed into this method is checked for the edge
     *                                  case that the uri passed in is just a filePath
     *
     * @param {string} uri - string which potentially could be either:
     *                       file path: '$HOME/.config/fish/config.fish'
     *                       or
     *                       uri: 'file:///$HOME/.config/fish/config.fish'
     * @returns {Promise<TextDocument>} [TODO:description]
     */
    openOrFind(uri: string): Promise<TextDocument>;
    /**
     * @async close(uri) -
     * @param uri - closes this uri its in the currently opened documents
     *
     * @returns
     */
    close(uri: string): void;
    /**
     * returns a correctly formatted string that is a vscode-uri
     *
     * @param {string} possibleURI - either a vscode-uri or a fspath
     * @returns {string} 'file:///path/to/fish/file.fish'
     */
    private validateURI;
}
//# sourceMappingURL=document.d.ts.map