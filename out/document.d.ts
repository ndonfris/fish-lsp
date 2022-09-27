import * as LSP from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextDocuments } from 'vscode-languageserver';
export declare enum FishFileType {
    function = 0,
    completion = 1,
    script = 2,
    config = 3,
    builtin_function = 4,
    builtin_completion = 5
}
export declare class LspDocuments {
    private readonly _files;
    private readonly openDocuments;
    listener: TextDocuments<TextDocument>;
    documents: Map<string, LspDocument>;
    constructor(listener: LSP.TextDocuments<TextDocument>);
    /**
     * gets the dependency for the the file/uri passed in
     *
     * @param {string} file - the file to find in the documents.
     * @returns {LspDocument | undefined} - the document found matching
     *                                      the uri if it exists
     */
    get(file: string): LspDocument | undefined;
    /**
     * normalizes a filepaths uri, and creates the textDocument. Also, sets the
     * dependencies for a newDocument.
     */
    newDocument(uri: string): Promise<void>;
    /**
     * return all the documents seen in the _files field
     */
    getOpenDocuments(): LspDocument[];
    /**
     * adds a new Uri to the _files array. Returns true if a document is opened
     * and false if a document is already opened
     */
    open(uri: string): Promise<boolean>;
    /**
     * deletes an item from the _files array, and returns the document
     */
    close(uri: string): LspDocument | undefined;
}
export declare class LspDocument implements TextDocument {
    protected document: TextDocument;
    private matchingDependency;
    private fishFileType;
    constructor(doc: LSP.TextDocumentItem);
    get uri(): string;
    get languageId(): string;
    get version(): number;
    getText(range?: LSP.Range): string;
    positionAt(offset: number): LSP.Position;
    offsetAt(position: LSP.Position): number;
    get lineCount(): number;
    getLine(line: number): string;
    getLineRange(line: number): LSP.Range;
    getLineEnd(line: number): LSP.Position;
    getLineOffset(line: number): number;
    getLineStart(line: number): LSP.Position;
    getFileName(): string;
    /**
     * checks what type of fish file the current TextDocument is
     * from the uri path
     *
     * @returns {FishFileType} config, functions, completions or script
     */
    setFishFileType(): FishFileType;
    setMatchingDep(): string;
    getFishFileType(): FishFileType;
    getMatchingDep(): string;
    applyEdit(version: number, change: LSP.TextDocumentContentChangeEvent): void;
}
//# sourceMappingURL=document.d.ts.map