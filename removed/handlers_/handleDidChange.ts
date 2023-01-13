import {fileURLToPath} from 'url';
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocumentChangeEvent } from "vscode-languageserver/node";
import { Analyzer } from "../analyze";
import { Context } from "../interfaces";
import {createTextDocumentFromFilePath} from '../utils/io';
//import { validate } from '../validation/validate'

export function getDidChangeContentHandler(context: Context) {
    const { trees, documents, analyzer } = context;

    context.connection.onDidChangeTextDocument(async change => {
        context.connection.console.error('handleDidChangeContent()')
        //const uri = change.uri; 
        //context.connection.console.error(`handleDidChangeContent(): ${uri}`)
        //const doc = context.documents.get(uri);
        //if (doc) {
        //    context.analyzer.analyze(context, doc);
        //} else {
        //    const newDoc = await createTextDocumentFromFilePath(context, new URL(change.uri))
        //    if (newDoc) await context.analyzer.initialize(context, newDoc)
        //}
    })
    //return function handleDidChangeContent(
        //change: TextDocumentChangeEvent<TextDocument>
    //): void {
            //context.connection.console.error('handleDidChangeContent()')
            //const doc = context.documents.get(change.document.uri);
            //if (doc) {
                //context.analyzer.analyze(context, doc);
            //} else {
                //const newDoc = createTextDocumentFromFilePath(context, new URL(change.document.uri))
                //if (newDoc) context.analyzer.initialize(context, newDoc)
            //}
    //};
}
