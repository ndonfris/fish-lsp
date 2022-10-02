import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocumentChangeEvent } from "vscode-languageserver/node";
import { Context } from "../interfaces";
export declare function getDidChangeContentHandler(context: Context): (change: TextDocumentChangeEvent<TextDocument>) => Promise<void>;
//# sourceMappingURL=handleDidChange.d.ts.map