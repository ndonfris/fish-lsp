
import { execCommandDocs } from '../utils/exec';
import { findNodeAt } from '../utils/tree-sitter';
import { analyze } from '../analyzer';
import {Context} from '../interfaces';
import {DocumentFormattingParams, Hover, HoverParams, TextDocumentPositionParams} from 'vscode-languageserver-protocol/node';
import {TextDocument} from 'coc.nvim';
import { findParentCommand } from '../utils/node-types'



export async function getCurrentNodeFromPostition(context: Context,params: TextDocumentPositionParams) {
    const {parser, asts, documents, roots} = context;
    const uri = params.textDocument.uri;

    //if (asts.has(roots)) {
        //
    //}
    //const currentTree()



}


export function getHandleHover(context: Context) {

    const {docs} = context


    return async function getHover(params: HoverParams | TextDocumentPositionParams) {
        const cmd = "";

        //findParentCommand(findNodeAt())


        const uri = params.textDocument.uri;
        if (!cmd) return;
        if (context.docs.has(cmd)) {
            return context.docs.get(cmd);
        }

        const tree = context.asts.get(uri)

        const textDoc = context.documents.get(uri)
        if (textDoc) {
            return textDoc
        }
        

        //TODO:
        // handle the hover
        //  -- check current docs
        //  -- add to docs or
        //  -- find variables if defined
        //  -- other cases

        // const newContext = await analyze(context, textDoc || context.documents.get())
        // await 

    };
}


