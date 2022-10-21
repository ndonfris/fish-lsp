import { TextDocument, Position, Range } from 'vscode-languageserver-textdocument';
import { RemoteConsole, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver';
import { FilepathResolver } from './utils/filepathResolver';
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
    static indexUserConfig(console: RemoteConsole, filepathResolver: FilepathResolver): Promise<DocumentManager>;
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
     * @async close(uri) - given a uri from the server, remove it from the open documents
     *                     object.
     * @param uri - closes this uri its in the currently opened documents
     */
    close(uri: string): void;
    /**
     * @async getLine() - Getter method to retrieve the line of the document passed in.
     *                    Text returned from this method is unedited, and is likely to
     *                    have leading whitespace
     *
     * @param {TextDocumentPositionParams} params - the uri, and position of a server call
     *                                              used for server.onHover(), onComplete()
     * @returns {Promise<string>} - The line of text in the uri, at the postion specified
     */
    getLine(params: TextDocumentPositionParams): Promise<string>;
    /**
     * returns a correctly formatted string that is a vscode-uri
     *
     * @param {string} possibleURI - either a vscode-uri or a fspath
     * @returns {string} 'file:///path/to/fish/file.fish'
     */
    private validateURI;
}
/**
 * get a range for document.getText()
 * returns range for the begining and end of the current line.
 */
export declare function getRangeFromPosition(position: Position): Range;
//# sourceMappingURL=document.d.ts.map