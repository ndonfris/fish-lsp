import {
  CompletionItem,
  Position,
  SymbolInformation,
  TextDocumentPositionParams,
} from 'vscode-languageserver-protocol/node'
import {CompletionList} from 'vscode-languageserver/node';
import {SyntaxNode} from 'web-tree-sitter';
import {Context} from '../interfaces';
import {createTextDocumentFromFilePath} from '../utils/io';





export function getCompletionHandler(context: Context) {

    const { completion, analyzer, documents, trees } = context

    return async function handleCompletion(params: TextDocumentPositionParams): Promise<CompletionList | null> {
        const uri = params.textDocument.uri;
        const line = params.position.line;
        const character = params.position.character;
        
        //context.connection.console.log("handleComplete")

        //console.log(`handleComplete()`)
        //console.log(`\turi: '${uri}'`)
        //console.log(`\tline: '${line}'`)
        //console.log(`\tcharacter: '${character}'`)
        //console.log(`\ttree: '${trees[uri]}'`)

        //const variables = trees[uri].variables;
        //const functions = trees[uri].functions;

        if (!documents.get(uri)) {
            const doc = await createTextDocumentFromFilePath(context, new URL(uri))
            if (!doc) return null
            trees[uri] = await analyzer.initialize(context, doc)
        }

        const currLine = analyzer.currentLine(context, uri, line)

        //const amountAdded = completion.addLocalMembers(variables, functions)
        // stores the amount of new completions found


        //if (currLine.endsWith('-')) {
        //    // get completion here
        //}

        const node: SyntaxNode | null = analyzer.nodeAtPoint(trees[uri], line, character);

        if (!node) return completion.fallback();

        try {
            const cmpList = await completion.generate(node);
            if (cmpList) return cmpList
        } catch (error) {
            //context.connection.console.error('handleCompletion() got error: '+error)
        }
        return completion.fallback();
    }

}
