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
import { buildBuiltins, buildDefaultCompletions, buildRegexCompletions, Completion, getShellCompletions, insideStringRegex } from "./completion";
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
                allCommitCharacters: [";", " ", "\t"],
                workDoneProgress: true,
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
        // • https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
        //this.connection.onCompletion(this.onDefaultCompletion.bind(this))
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

    // what you've been looking for:
    //      fish_indent --dump-parse-tree test-fish-lsp.fish
    // https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
    // https://github.com/microsoft/vscode-languageserver-node/pull/322
    // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextModehttps://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextMode
    // 
    // • clean up into completion.ts file & Decompose to state machine, with a function that gets the state machine in this class.
    //         DART is best example i've seen for this.
    //         ~ https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202 ~
    // • Add markdown
    // • USE TRIGGERKIND as seen below in logger (4 lines down).
    // • Implement both escapedCompletion script and dump synatx tree script
    // • Add default CompletionLists to complete.ts
    // • Add local file items.
    // • Lastly add parameterInformation items.  [ 1477 : ParameterInformation ]
    public async onCompletion(completionParams: CompletionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;
        logger.log(`completionParams.context.triggerKind: ${completionParams.context?.triggerKind}`)

        logger.log('server.onComplete' + uri)
        const doc = await this.docs.openOrFind(uri);
        //const node: SyntaxNode | null = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character - 2); // better way to do this below

        //const currnode = this.analyzer.boundaryCheckNode(uri, position.line, position.character)

        //const r = getRangeFromPosition(completionParams.position);
        this.connection.console.log('on complete node: ' + doc.uri || "" )

        const documentLine: TextDocument = this.analyzer.currentLine(doc, completionParams.position) || " "
        const line = documentLine.getText()

        if (line.trimStart().startsWith("#")) {
            return null;
        }

        logger.log('line' + line)
        const items: CompletionItem[] = []
        if (insideStringRegex(line)) {
            logger.log(`insideStringRegex: ${true}`)
            items.push(...buildRegexCompletions())
            return CompletionList.create(items, true)
        }
        
        try {
            // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! 
            // right here parse the line forward for the last command in the scope !!!
            let cmdNode = null;
            const output = await getShellCompletions(line)
            const lineToParse = line.trimEnd();
            const root = this.parser.parse(lineToParse).rootNode;
            const currNode = root.namedDescendantForPosition({row: 0, column: lineToParse.length - 1})

            const cmp = new CompletionItemBuilder()
            const commandNode = firstAncestorMatch(currNode, n => isCommand(n));

            if (commandNode) {
                logger.log(' commandNode: ' + commandNode.text)
            } else {
                logger.log(` firstAncestorMatch(${currNode.text}, isCommand) failed `)
            }
            let cmdText = commandNode?.text.replace(/\s+(\w+)\s+.*/, '') || "";

            let fishKind = FishCompletionItemKind.FLAG;
            for (const [label, desc, other] of output) {
                const otherText = other.length > 0 ? other : cmdText
                fishKind = parseLineForType(label, desc, otherText)
                if (commandNode && (fishKind != FishCompletionItemKind.LOCAL_VAR && fishKind != FishCompletionItemKind.GLOBAL_VAR)) {
                    fishKind = FishCompletionItemKind.FLAG;
                }
                const item = cmp.create(label)
                    .documentation([desc, other].join(' '))
                    .kind(fishKind)
                    .originalCompletion([label, desc].join('\t') + ' ' + other)
                    .build()
                switch (fishKind) {
                    case FishCompletionItemKind.ABBR: 
                        item.insertText = other;
                        item.commitCharacters = [';', " "]; // look at manager way up 
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
            return CompletionList.create(buildDefaultCompletions(), true)
        }
        items.push(...buildBuiltins())
        return CompletionList.create(items, true)
    }


    public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        const fishItem = item as FishCompletionItem
        let newDoc: string | MarkupContent;
        let typeCmdOutput = ''
        let typeofDoc = ''
        switch (fishItem.kind) {
            //item.documentation = enrichToCodeBlockMarkdown(fishItem.data?.originalCompletion, 'fish')
            case CompletionItemKind.Constant: 
            case CompletionItemKind.Variable: 
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

