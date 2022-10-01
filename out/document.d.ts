import * as LSP from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
export declare enum FishFileType {
    function = 0,
    completion = 1,
    script = 2,
    config = 3,
    builtin_function = 4,
    builtin_completion = 5
}
export declare class LspDocument implements TextDocument {
    protected document: TextDocument;
    private matchingDependency;
    private fishFileType;
    constructor(doc: TextDocument);
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