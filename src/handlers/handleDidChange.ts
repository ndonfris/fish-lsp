import {fileURLToPath} from 'url';
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocumentChangeEvent } from "vscode-languageserver/node";
import { Analyzer } from "../analyze";
import { Context } from "../interfaces";
import {createTextDocumentFromFilePath} from '../utils/io';
//import { validate } from '../validation/validate'

export function getDidChangeContentHandler(context: Context) {
    const { trees, documents, analyzer } = context;

    return async function handleDidChangeContent(
        change: TextDocumentChangeEvent<TextDocument>
    ): Promise<void> {
            context.connection.console.error('handleDidChangeContent()')
            const doc = documents.get(change.document.uri);
            if (doc) {
                await analyzer.analyze(context, doc);
            } else {
                const newDoc = await createTextDocumentFromFilePath(context, new URL(change.document.uri))
                if (newDoc) trees[change.document.uri] = await analyzer.initialize(context, newDoc)
            }
    };
}
