/// <reference types="node" />
import { URL } from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Context } from '../interfaces';
export declare function createTextDocumentFromFilePath(context: Context, url: URL): Promise<TextDocument | null>;
export declare function getFishFilesInDir(uri: string): URL[];
//# sourceMappingURL=io.d.ts.map