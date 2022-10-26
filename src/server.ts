import Parser from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
import { initializeParser } from "./parser";
//import { MyAnalyzer } from "./analyse";
import { Analyzer } from "./analyze";
import { getAllFishLocations } from "./utils/locations";
import { logger } from "./logger";
import { buildDefaultCompletions, buildRegexCompletions, Completion, getShellCompletions } from "./completion";
import { createTextDocumentFromFilePath } from "./utils/io";
import {
    ClientCapabilities,
    createConnection,
    InitializeParams,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    ServerCapabilities,
    TextDocumentPositionParams,
    CompletionParams,
    TextDocumentChangeEvent,
    Connection,
    InitializedParams,
    RemoteConsole,
    CompletionList,
    CompletionItem,
    MarkedString,
    MarkupContent,
    CompletionItemKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {CliOptions, Context, TreeByUri} from './interfaces';
import { SyntaxNode } from 'web-tree-sitter';
import {URI} from 'vscode-uri';
import { DocumentManager, getRangeFromPosition } from './document';
import {ancestorMatch, descendantMatch, firstAncestorMatch, getChildNodes, getNodeText} from './utils/tree-sitter';
import {findParentCommand, isCommand, isLocalVariable, isQuoteString, isRegexArgument, isStatement, isVariable} from './utils/node-types';
import { FishCompletionItem, FishCompletionItemKind, handleCompletionResolver, isBuiltIn} from './utils/completion-types';
import { FilepathResolver } from './utils/filepathResolver';
import { CompletionItemBuilder, parseLineForType } from './utils/completionBuilder';
//import {isBuiltin} from './utils/builtins';
import { documentationHoverProvider, enrichToCodeBlockMarkdown, enrichToMarkdown } from './documentation';
import { execCommandDocs, execCommandType } from './utils/exec';




export default class FishServer {


    public static async initialize(
        connection: Connection,
        { capabilities }: InitializeParams
    ): Promise<FishServer> {
        logger.setConsole(connection.console)
        const parser = await initializeParser();
        const filepaths = FilepathResolver.create()
        return Promise.all([
            new Analyzer(parser),
            DocumentManager.indexUserConfig(connection.console),
            Completion.initialDefaults(),
        ]).then(
            ([analyzer, docs, completion]) =>
            new FishServer(connection, parser, analyzer, docs, completion)
        );
    }

    // the connection of the FishServer
    private connection: Connection;

    // for logging output (from connection)
    private console: RemoteConsole;
    // convert this to a singleton object and globally access it 

    // the parser (using tree-sitter-web)
    private parser : Parser;

    // using the parser & DocumentManager
    // current implementation ideally works in this order:
    // 1.) a document is retrieved from the DocumentManager 
    // 2.) the document is Parsed by the Parser
    // 3.) the analyzer stores the document???
    // 4.) 
    private analyzer: Analyzer; 

    // documentManager 
    private docs: DocumentManager;

    // completionHandler
    private completion: Completion;

    constructor(connection: Connection, parser : Parser, analyzer: Analyzer, docs: DocumentManager , completion: Completion) {
        this.connection = connection;
        this.console = this.connection.console;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.completion = completion;
    }



    public capabilities(): ServerCapabilities {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ["$", "-", "\\"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            //documentSymbolProvider: true,
            //workspaceSymbolProvider: true,
            //referencesProvider: true,
        };
    }

    public register(): void {
        this.docs.documents.listen(this.connection)
        this.connection.onDidOpenTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = await this.docs.openOrFind(uri)
            this.analyzer.analyze(doc);
            logger.log(this.connection.onDidOpenTextDocument.name, {document:doc})
        })

        this.connection.onDidChangeTextDocument(async change => {
            const uri = change.textDocument.uri;
            let doc = await this.docs.openOrFind(uri);
            logger.log(this.connection.onDidChangeTextDocument.name, {extraInfo: [doc.uri, '\nchanges:', ...change.contentChanges.map(c => c.text)]})
            doc = TextDocument.update(doc, change.contentChanges, change.textDocument.version);
            this.analyzer.analyze(doc);
            const root = this.analyzer.getRoot(doc)
            // do More stuff
        });


        this.connection.onDidCloseTextDocument(async change => { 
            const uri = change.textDocument.uri;
            this.docs.close(uri);
        });

        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))

        // • for multiple completionProviders -> https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts#L15
        this.connection.onCompletion(this.onCompletion.bind(this))
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));


        this.docs.documents.onDidChangeContent(async change => {
            const document = change.document;
            const uri = document.uri;
            let doc = await this.docs.openOrFind(uri);
            logger.log('documents.onDidChangeContent: ' + doc.uri)
            logger.log(doc.getText())
            this.analyzer.analyze(doc);
        })

    }

    public async onCompletion(completionParams: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;


        logger.log('server.onComplete' + uri)
        const doc = await this.docs.openOrFind(uri);
        const node: SyntaxNode | null = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character - 2); // better way to do this below

        const currnode = this.analyzer.boundaryCheckNode(uri, position.line, position.character)

        //const r = getRangeFromPosition(completionParams.position);
        this.connection.console.log('on complete node: ' + doc.uri || "" )

        const documentLine: TextDocument = this.analyzer.currentLine(doc, completionParams.position) || " "
        const line = documentLine.getText()

        //if (currnode) {
        //    logger.log(`currNode: ${currnode?.text} && ${currnode?.type} && ${isQuoteString(currnode)}`)
        //    logger.log(``)
        //}
        const isRegexString = this.analyzer.isStringRegex(uri, position.line, position.character)
        logger.log(`${isRegexString}: isRegexArgument`)
        
        const items: CompletionItem[] = []
        if (line.endsWith("'") || line.endsWith('"') || (currnode && isQuoteString(currnode)) || isRegexString) {
            logger.log(`extraCheck: ${isRegexString}: isRegexArgument`)
            items.push(...buildRegexCompletions())
            return CompletionList.create(items, true)
        }

        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 
        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 
        // right here parse the line forward for the last command in the scope !!!
        let cmdNode = null;
        //if (node) {
        //    cmdNode = findParentCommand(node);
        //    if (cmdNode) {
        //        logger.log('cmdNode ' + cmdNode.text)
        //        logger.log('currnode: ' + node.parent?.text)
        //    }
        //}

        //if (line.startsWith("\#")) {
        //    return null;
        //}
        try {
            logger.log('line' + line)
            const output = await getShellCompletions(line)
            //output.forEach(([label, keyword, otherInfo]) => {
            //    logger.log(`label: '${label}'\nkeyword: '${keyword}'\notherInfo: '${otherInfo}'`)
            //});
            const tree = this.parser.parse(line)
            const rootLineNode = tree.rootNode;
            const logNode = rootLineNode.descendantForPosition({row: 0, column: completionParams.position.character -1 })
            const lNode = rootLineNode.namedDescendantForPosition({row: 0, column: completionParams.position.character - 1})

            logger.log(`line length: ${ line.length }`)
            logger.log('-------------------------');
            logger.log(`character: ${completionParams.position.character}`)
            logger.log(`line: ${completionParams.position.line}`)
            logger.log('-------------------------');
            logger.log( 'logNode: ' + logNode.text );
            logger.log('-------------------------');
            logger.log( 'lNode: ' + lNode.text );
            logger.log('-------------------------');
            
            const commandNodes = firstAncestorMatch(lNode, isCommand);
            if (commandNodes) {
                logger.log(' n: ' + commandNodes.text)
            } else {
                logger.log(` firstAncestorMatch(${lNode.text}, isCommand) failed `)
            }
            //for (const n of commandNodes) {
            //}

            //currentScopeRootIsCommand(this.parser, line);
            //for (const node of commandNodes) {
            //    logger.log(`cmdnode: ${node.child(0)?.text}, types: ${node.type}`)
            //}
            //for (const node of getChildNodes(rootLineNode)) {
            //    logger.log(`node: ${node.child(0)?.text}, types: ${node.type}`)
            //}
            const cmp = new CompletionItemBuilder()
            //if (output.length == 0) {
            //    return null;
            //}
            let fishKind = FishCompletionItemKind.FLAG;
            for (const [label, desc, other] of output) {
                if (!cmdNode) {
                    fishKind = parseLineForType(label, desc, other)
                }
                const item = cmp.create(label)
                    .documentation([desc, other].join(' '))
                    .kind(fishKind)
                    .originalCompletion([label, desc].join('\t') + ' ' + other)
                    .build()
                switch (fishKind) {
                    case FishCompletionItemKind.ABBR: 
                        item.insertText = other;
                        break
                    default:
                        break
                }
                items.push(item)
                cmp.reset()
            }
        } catch (e) {
            this.connection.console.log("error" + e)
            this.connection.console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
            this.connection.console.log(doc.getText())
            this.connection.console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~")
            items.push(...buildDefaultCompletions())
            return CompletionList.create(items, true) 
        }
        return CompletionList.create(items, true)
    }


    public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        const fishItem = item as FishCompletionItem
        let newDoc: string | MarkupContent;
        let typeCmdOutput = ''
        let typeofDoc = ''
        switch (fishItem.kind) {
            case CompletionItemKind.Constant: 
                item.documentation = enrichToCodeBlockMarkdown(fishItem.data?.originalCompletion, 'fish')
            case CompletionItemKind.Variable: 
                item.documentation = enrichToCodeBlockMarkdown(fishItem.data?.originalCompletion, 'fish')
            case CompletionItemKind.Field: 
            case CompletionItemKind.Interface: 
                //const newDoc = enrichToCodeBlockMarkdown()
                return item;
            case CompletionItemKind.Function:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'fish')
                return item;
            case CompletionItemKind.Unit:
                typeCmdOutput = await execCommandType(fishItem.label)
                if (typeCmdOutput != '') {
                    newDoc = await execCommandDocs(fishItem.label)
                    item.documentation = typeCmdOutput === 'file' 
                        ? enrichToCodeBlockMarkdown(newDoc, 'fish') : enrichToCodeBlockMarkdown(newDoc, 'man')
                }
                return item;
            case CompletionItemKind.Class:
            case CompletionItemKind.Method:
            case CompletionItemKind.Keyword:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
                return item;
            default:
                return item;
        }
    }
}


function currentScopeRootIsCommand(parser: Parser, line: string) {
    const root = parser.parse(line).rootNode;
    for (const node of getChildNodes(root)) {
        logger.log(`scope node: ${node.text}, types: ${node.type}`)
        //if (isStatement(node)) {

        //}
        //if (isCommand(node)) {

        //}
    }
}

