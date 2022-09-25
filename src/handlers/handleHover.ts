
import { findNodeAt, getNodeText } from '../utils/tree-sitter';
import { analyze } from '../analyzer';
import {Context} from '../interfaces';
import {Hover, HoverParams, TextDocumentPositionParams} from 'vscode-languageserver-protocol/node';
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

export async function resolveUnknownDocument(uri: string, context: Context): Promise<TextDocument | null> {
    
    const currDoc = context.documents.get(uri);
    if (currDoc != undefined) {
        await analyze(context, currDoc);
        return currDoc;
    }

    for (const doc of context.documents.all()) {
        await analyze(context, doc);
        if (doc.uri == uri) {
            return doc;
        }
    }
    return null;

}


export function getHandleHover(context: Context) {

    const {roots, asts, docs} = context


    return async function getHover(params: HoverParams): Promise<void | Hover> {

        const uri = params.textDocument.uri;
        const currentDoc = await resolveUnknownDocument(uri, context)

        if (!currentDoc){
            return 
        }
        
        const currentNode = findNodeAt(context.asts.get(uri).rootNode.tree, params.position.line, params.position.character)

        if (!currentNode) return

        const cmdNode = findParentCommand(currentNode)!
        if (!cmdNode) return

        const cmd = getNodeText(cmdNode)

        if (!cmd) return;
        if (context.docs.has(cmd)) {
            return context.docs.get(cmd);
        }

        return

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


