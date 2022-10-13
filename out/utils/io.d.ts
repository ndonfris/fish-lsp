/// <reference types="node" />
import { URL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
export declare function createTextDocumentFromFilePath(url: URL): Promise<TextDocument | null>;
export declare function getFishFilesInDir(uri: string): URL[];
//# sourceMappingURL=io.d.ts.map