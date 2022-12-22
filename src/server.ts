import Parser from "web-tree-sitter";
import { initializeParser } from "./parser";
import { Analyzer } from "./analyze";
//import { logger } from "./logger";
import { buildDefaultCompletions, buildRegexCompletions, documentSymbolToCompletionItem, generateShellCompletionItems, insideStringRegex, } from "./completion";
import { InitializeParams, TextDocumentSyncKind, ServerCapabilities, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, CompletionItemKind, DocumentSymbolParams, DefinitionParams, Location, LocationLink, ReferenceParams, DocumentSymbol, DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, InitializeResult } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
//import {CliOptions, Context, TreeByUri} from './interfaces';
import { LspDocuments, LspDocument } from './document';
import { FishCompletionItem, } from './utils/completion-types';
import { enrichToCodeBlockMarkdown } from './documentation';
import { execCommandDocs, execCommandType, execFindDependency } from './utils/exec';
import { findLocalDefinition, getNearestSymbols, getReferences } from './symbols';
import {Logger} from './logger';
import {uriToPath} from './utils/translation';




export default class FishServer {


    public static async create(
        connection: Connection,
        { rootPath, rootUri, capabilities }: InitializeParams,
    ): Promise<FishServer> {
        const parser = await initializeParser();
        const documents = new LspDocuments() ;
        const analyzer = new Analyzer(parser)
        return new FishServer(connection, parser, analyzer, documents)
    }

    // the connection of the FishServer
    private connection: Connection;

    // the parser (using tree-sitter-web)
    private parser: Parser;

    private analyzer: Analyzer; 

    // documentManager 
    private docs: LspDocuments;

    protected logger: Logger;

    constructor(connection: Connection, parser : Parser, analyzer: Analyzer, docs: LspDocuments ) {
        this.connection = connection;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.logger = new Logger(connection);
    }


    async initialize(params: InitializeParams): Promise<InitializeResult> {
        this.connection.console.log(
            `Initialized server FISH-LSP with ${params.workspaceFolders}`
        )
        /*const server = await FishServer.create(connection, params);*/


        const result : InitializeResult = {
            capabilities: {
                // For now we're using full-sync even though tree-sitter has great support
                // for partial updates.
                textDocumentSync: TextDocumentSyncKind.Full,
                completionProvider: {
                    resolveProvider: true,
                    triggerCharacters: ["."],
                    //triggerCharacters: ["$", "-", "\\"],
                    allCommitCharacters: [";", " ", "\t"],
                    workDoneProgress: true,
                },
                hoverProvider: true,
                documentHighlightProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                //signatureHelpProvider: {
                //    triggerCharacters: ["'", '"', "[", ":"],
                //},
                documentSymbolProvider: true,
            }
        }
        return result;
    }


    public register(): void {
        //this.docs. .listen(this.connection)
        this.connection.console.log("Starting FishLsp.register()")

        this.connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this))
        this.connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this))
        this.connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this))
        this.connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this))

        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //this.connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))

        // • for multiple completionProviders -> https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts#L15
        // • https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
        //this.connection.onCompletion(this.onDefaultCompletion.bind(this))
        this.connection.onCompletion(this.onCompletion.bind(this))
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this)),
        //this.connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));

        this.connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
        this.connection.onDefinition(this.onDefinition.bind(this));
        this.connection.onReferences(this.onReferences.bind(this));
        this.connection.console.log("FINISHED FishLsp.register()")
    }

    didOpenTextDocument(params: DidOpenTextDocumentParams): void {
        this.logger.log("[FishLsp.onDidOpenTextDocument()]")
        //this.logger.log(JSON.stringify({change}, null, 2))
        /*this.logger.log(JSON.parse(JSON.stringify({"change": change}))); ;*/
        const document = params.textDocument;
        //const uri = document.uri;
        const uri = uriToPath(params.textDocument.uri.toString());
        this.logger.log(`[FishLsp.onDidOpenTextDocument()] uri: ${uri}`)
        if (!uri) {
            this.logger.log("uri is null")
            return;
        }
        if (this.docs.open(uri, params.textDocument) ) { 
            const doc = this.docs.get(uri);
            if (doc) {
                this.logger.log("opened document: " + params.textDocument.uri)
                this.analyzer.analyze(doc);
                this.logger.log("analyzed document: " + params.textDocument.uri)
                return;
            }
        } else {
            this.logger.log(`Cannot open already opened doc '${params.textDocument.uri}'.`);
            this.didChangeTextDocument({
                textDocument: params.textDocument,
                contentChanges: [
                    {
                        text: params.textDocument.text,
                    },
                ],
            });
        }
    }

    didChangeTextDocument(params: DidChangeTextDocumentParams): void {
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return;
        const doc = this.docs.get(uri);
        this.logger.log(`[${ this.connection.onDidChangeTextDocument.name }]: ${params.textDocument.uri}` );
        if (!doc) return;
        params.contentChanges.forEach(newContent => {
            doc.applyEdit(params.textDocument.version, newContent)
        })
    }

    didCloseTextDocument(params: DidCloseTextDocumentParams): void {
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return;
        this.logger.log(`[${this.connection.onDidCloseTextDocument.name}]: ${params.textDocument.uri}`);
        this.docs.close(uri);
        this.logger.log(`closed uri: ${uri}`);
    }

    didSaveTextDocument(params: DidSaveTextDocumentParams): void {
        this.logger.log(`[${this.connection.onDidSaveTextDocument.name}]: ${params.textDocument.uri}`);
    }

    // @TODO: REFACTOR THIS OUT OF SERVER
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
    public async onCompletion(params: CompletionParams):  Promise<CompletionList | null>{
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return null;
        //logger.log(`completionParams.context.triggerKind: ${params.context?.triggerKind}`)
        this.logger.log('server.onComplete' + uri);

        const doc = this.docs.get(uri);
        if (!doc) {
            this.logger.log('onComplete got [NOT FOUND]: ' + uri)
            return null;
        }
        const line: string = doc.getLine(params.position.line)
        this.logger.log(`onComplete: ${uri} : ${line}`)

        if (line.trimStart().startsWith("#")) {
            return null;
        }

        const root = this.parser.parse(doc.getText()).rootNode;

        const lineToParse = line.trimEnd();
        const currNode = this.parser.parse(lineToParse).rootNode.descendantForPosition({row: 0, column: lineToParse.length - 1});

        const items: CompletionItem[] = [
            ...documentSymbolToCompletionItem(getNearestSymbols(root, currNode), doc),
            ...buildDefaultCompletions(),
        ];

        if (insideStringRegex(line)) {
            //logger.log(`insideStringRegex: ${true}`)
            items.push(...buildRegexCompletions())
            return CompletionList.create(items, true)
        }
        const shellItems: CompletionItem[] = await generateShellCompletionItems(line, currNode);
        if (shellItems.length > 0) {
            items.push(...shellItems)
            return CompletionList.create(items, true)
        }
        //items.push(...await generateShellCompletionItems(line, currNode));
        //items.push(...buildBuiltins())
        return CompletionList.create(items, true)
    }


    public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        const fishItem = item as FishCompletionItem
        let newDoc: string | MarkupContent;
        let typeCmdOutput = ''
        let typeofDoc = ''
        if (fishItem.data.localSymbol == true) {
            return item;
        }
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


    // @TODO: fix this to return a signle SignatureHelp object
    //public async onShowSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp> {
    //    const uri: string = params.textDocument.uri;
    //    //const position = params.position;
    //    const doc = await this.docs.openOrFind(uri);

    //    const documentLine: string = this.analyzer.currentLine(doc, params.position).getText().trimStart() || " "
    //    //const line = documentLine.getText().trimStart()
    //    //const root = this.parser.parse(line).rootNode;
    //    //const currNode = root.namedDescendantForPosition({row: 0, column: line.length - 1})
    //    //const commandNode = firstAncestorMatch(currNode, n => isCommand(n));
    //    const lastWord = documentLine.split(/\s+/).pop() || ""
    //    if (insideStringRegex(documentLine)) {
    //        if (lastWord.includes('[[') && !lastWord.includes(']]') ) {
    //            this.signature.activeSignature = signatureIndex["stringRegexCharacterSets"]
    //        } else {
    //            this.signature.activeSignature = signatureIndex["stringRegexPatterns"]
    //        }
    //    } else {
    //        this.signature.activeSignature = null;
    //    }
    //    this.signature.activeParameter = null;
    //    return this.signature;
    //}


    public async onDocumentSymbols(params: DocumentSymbolParams): Promise<DocumentSymbol[]> {
        //logger.log("onDocumentSymbols");
        const uri: string = params.textDocument.uri;
        const doc = this.docs.get(uri);
        const symbols : DocumentSymbol[] = [];
        if (!doc) {
            return symbols;
        }
        const root = this.parser.parse(doc.getText()).rootNode;
        //this.symbolMap = getDocumentSymbols(root);
        //const returnSymbols = sym
        //for (const sym of Array.from(symbols.values())) {
        //    logger.logDocumentSymbol(sym)
        //}
        //this.symbolMap = new Map<SyntaxNode, DocumentSymbol[]>(symbols);
        return symbols
    }

    public async onDefinition(params: DefinitionParams): Promise<LocationLink[]> {
        //logger.log("getDefinition");
        const uri: string = params.textDocument.uri;
        const position = params.position;
        const doc = this.docs.get(uri);
        if (!doc) {
            return [];
        }
        const root = this.parser.parse(doc.getText()).rootNode;
        let node = this.analyzer.nodeAtPoint(uri, position.line, position.character);
        //logger.logNode(node);
        if (!node) return [];
        const depedencyUri = await execFindDependency(node.text)
        const localDefinitions = findLocalDefinition(uri, root, node) || [];
        return localDefinitions
        //const newDoc = await this.docs.get(depedencyUri);
        //const newDocRoot = this.parser.parse(newDoc.getText()).rootNode;
        //const globalDefinitions = findGlobalDefinition(newDoc.uri, newDocRoot, node) || [];
        //return [...globalDefinitions, ...localDefinitions ]
    }


    public async onReferences(params: ReferenceParams): Promise<Location[]> {
        //logger.log("onReferences");
        const uri: string = params.textDocument.uri;
        const position = params.position;
        const doc = this.docs.get(uri);
        if (!doc) {
            return [];
        }
        const root = this.parser.parse(doc.getText()).rootNode;
        const node = this.analyzer.nodeAtPoint(uri, position.line, position.character);
        if (!node) return [];
        return getReferences(uri, root, node) || []
    }
}

