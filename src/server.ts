import Parser, {SyntaxNode} from "web-tree-sitter";
import { initializeParser } from "./parser";
import { Analyzer } from "./analyze";
import {  generateCompletionList, } from "./completion";
import { InitializeParams, TextDocumentSyncKind, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, CompletionItemKind, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, CodeActionParams, CodeAction, DocumentRangeFormattingParams, ExecuteCommandParams, ServerRequestHandler, FoldingRangeParams, FoldingRange, Position, InlayHintParams, MarkupKind, SymbolInformation, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, RemoteConsole, RenameFilesParams } from "vscode-languageserver";
import * as LSP from 'vscode-languageserver';
import { LspDocument, LspDocuments } from './document';
import { enrichToCodeBlockMarkdown } from './documentation';
import { applyFormattedTextInRange, applyFormatterSettings } from './formatting';
import { execCommandDocs, execCommandType, execFindDependency, execFormatter, execOpenFile } from './utils/exec';
import {createServerLogger, Logger, ServerLogsPath} from './logger';
import {toFoldingRange, uriToPath} from './utils/translation';
import {ConfigManager} from './configManager';
import { getNearbySymbols, getDefinitionKind, DefinitionKind, getLocalDefs, getLocalRefs } from './workspace-symbol';
import { getDefinitionSymbols}  from './workspace-symbol';
import { getChildNodes, getRange } from './utils/tree-sitter';
import { handleHover } from './hover';
import { /*getDiagnostics*/ } from './diagnostics/validate';
import { CodeActionKind } from './code-action';
import {FishAutoFixProvider} from './features/fix-all';
import * as Locations from './utils/locations';
import {FishProtocol} from './utils/fishProtocol';
import {Commands} from "./commands"
import {isFunctionDefinition, isStatement} from './utils/node-types';
import {handleConversionToCodeAction} from './diagnostics/handleConversion';
import {FishShellInlayHintsProvider} from './features/inlay-hints';
import { DocumentationCache, initializeDocumentationCache } from './utils/documentationCache';
import { collectAllSymbolInformation, DocumentDefSymbol } from './symbols';
import { SymbolTree } from './symbolTree';
import { homedir } from 'os';
import { initializeDefaultFishWorkspaces } from './utils/workspace';
import { filterLastPerScopeSymbol, FishDocumentSymbol } from './document-symbol';
import { FishCompletionItem, FishCompletionData, FishCompletionItemKind } from './utils/completion-strategy';
import { getRenameLocations, getRenameWorkspaceEdit, getRefrenceLocations } from './renames';
import { getFlagDocumentationAsMarkup } from './utils/flag-documentation';

// @TODO 
export type SupportedFeatures = {
    codeActionDisabledSupport : boolean;
}

export default class FishServer {

    public static async create(
        connection: Connection,
        params: InitializeParams,
    ): Promise<FishServer> {
        const documents = new LspDocuments() ;
        const config = new ConfigManager(documents);
        config.mergePreferences(params.initializationOptions);
        const logger = new Logger(ServerLogsPath, true, connection.console);
        return await Promise.all([
            initializeParser(),
            initializeDocumentationCache(),
            initializeDefaultFishWorkspaces(),
        ]).then(([parser, cache, workspaces]) => {
            const analyzer = new Analyzer(parser, workspaces);
            return new FishServer(connection, config, parser, analyzer, documents, cache, logger);
        })
    }

    private initializeParams: InitializeParams | undefined;
    // the connection of the FishServer
    private connection: Connection;
    private documentationCache: DocumentationCache;
    private parser: Parser;
    private analyzer: Analyzer; 
    // documentManager 
    private docs: LspDocuments;
    private config: ConfigManager;
    protected logger: Logger;
    protected features: SupportedFeatures;

    constructor(connection: Connection, config: ConfigManager, parser : Parser, analyzer: Analyzer, docs: LspDocuments, documentationCache: DocumentationCache, logger: Logger) {
        this.connection = connection;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.config = config;
        this.logger = logger;
        this.features = { codeActionDisabledSupport: false };
        this.documentationCache = documentationCache;
    }

    async initialize(params: InitializeParams): Promise<InitializeResult> {
        this.logger.log(
            `Initialized server FISH-LSP with ${params.workspaceFolders || ''}`
        )
        const result : InitializeResult = {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                completionProvider: {
                    resolveProvider: true,
                    triggerCharacters: ["-", "\$"],
                    allCommitCharacters: [";", " ", "\t"],
                    workDoneProgress: true,
                },
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                renameProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                foldingRangeProvider: true,
                codeActionProvider: {
                    codeActionKinds: [
                        ...FishAutoFixProvider.kinds.map(kind => kind.value),
                        CodeActionKind.RefactorToFunction.value,
                        CodeActionKind.RefactorToVariable.value,
                        CodeActionKind.QuickFix.append('extraEnd').value,
                    ],
                    resolveProvider: true,
                },
                executeCommandProvider: {
                    commands: [
                        Commands.APPLY_REFACTORING,
                        Commands.SELECT_REFACTORING,
                        Commands.APPLY_WORKSPACE_EDIT,
                        Commands.RENAME,
                        "onHover",
                        'rename'
                    ],
                    workDoneProgress: true,
                },
                documentSymbolProvider: {
                    label: "Fish-LSP",
                },
                workspaceSymbolProvider: {
                    resolveProvider: true,
                },
                documentHighlightProvider: false,
                inlayHintProvider: false,
            },
        }
        this.config.mergePreferences(params.initializationOptions);
        this.logger.log('onInitializedResult', result)
        return result;
    }
    

    register(): void {
        //this.connection.window.createWorkDoneProgress();
        this.connection.onInitialized(this.onInitialized.bind(this));
        this.connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this))
        this.connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this))
        this.connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this))
        this.connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this))
        // • for multiple completionProviders -> https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts#L15
        // • https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
        this.connection.onCompletion(this.onCompletion.bind(this))
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this)),

        //this.on
        this.connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
        this.connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));
        //this.connection.onWorkspaceSymbolResolve(this.onWorkspaceSymbolResolve.bind(this))
        this.connection.onDefinition(this.onDefinition.bind(this));
        this.connection.onReferences(this.onReferences.bind(this));
        this.connection.onHover(this.onHover.bind(this));
        this.connection.onRenameRequest(this.onRename.bind(this));
        this.connection.onDocumentFormatting(this.onDocumentFormatting.bind(this));
        this.connection.onDocumentRangeFormatting(this.onDocumentRangeFormatting.bind(this));
        this.connection.onCodeAction(this.onCodeAction.bind(this));
        this.connection.onFoldingRanges(this.onFoldingRanges.bind(this))
        //this.connection.workspace.applyEdit()
        //this.connection.languages.inlayHint.on(this.onInlayHints.bind(this));
        //this.connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));
        this.connection.console.log("FINISHED FishLsp.register()")
    }

    didOpenTextDocument(params: DidOpenTextDocumentParams): void {
        this.logParams("didOpenTextDocument", params);
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) {
            this.logger.log(`DID NOT OPEN ${uri} \n URI is null or undefined`)
            return;
        }
        if (this.docs.open(uri, params.textDocument)) { 
            const doc = this.docs.get(uri);
            if (doc) {
                this.logger.log("opened document: " + params.textDocument.uri)
                this.analyzer.analyze(doc);
                this.logger.log("analyzed document: " + params.textDocument.uri)
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
        this.logParams("didChangeTextDocument", params);
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        if (!uri || !doc) return;
        doc.applyEdits(doc.version+1, ...params.contentChanges)
        this.analyzer.analyze(doc);
        this.logger.log(`CHANGED -> ${doc.version}:::${doc.uri}`)
        const root = this.analyzer.getRootNode(doc);
        if (!root) return 
    }

    didCloseTextDocument(params: DidCloseTextDocumentParams): void {
        this.logParams("didCloseTextDocument", params);
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return;
        this.logger.log(`[${this.didCloseTextDocument.name}]: ${params.textDocument.uri}`);
        this.docs.close(uri);
        this.logger.log(`closed uri: ${uri}`);
    }

    didSaveTextDocument(params: DidSaveTextDocumentParams): void {
        this.logParams("didSaveTextDocument", params);
        return;
    }



    // @see:
    //  • @link [bash-lsp](https://github.com/bash-lsp/bash-language-server/blob/3a319865af9bd525d8e08cd0dd94504d5b5b7d66/server/src/server.ts#L236)
    async onInitialized() {
        return {
            backgroundAnalysisCompleted: this.startBackgroundAnalysis()
        }
    }

    // @TODO: REFACTOR THIS OUT OF SERVER
    // what you've been looking for:
    //      fish_indent --dump-parse-tree test-fish-lsp.fish
    // https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
    // https://github.com/microsoft/vscode-languageserver-node/pull/322
    // 
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
    // convert to CompletionItem[]
    async onCompletion(params: CompletionParams):  Promise<CompletionItem[]>{
        //const t = params.
        this.logParams("onCompletion", params)
        const uri = uriToPath(params.textDocument.uri);
        let newCompletionList: CompletionItem[] = [];
        const doc = this.docs.get(uri);

        if (!uri || !doc) {
            this.logger.log('onComplete got [NOT FOUND]: ' + uri)
            return [];
        }
        const { line } = this.analyzer.parseCurrentLine(doc, params.position)
        this.logger.log(`currentLine: "${line}"`);

        if (line.trim().startsWith("#")) return [];

        try {
            newCompletionList = await generateCompletionList(doc, this.analyzer, params.position, params.context);
            this.logger.logPropertiesForEachObject(newCompletionList, "label", "kind", "insertText", "insertTextFormat", "data")
            
            this.logger.log(`line: '${line}' got ${newCompletionList.length} items"`)
        } catch (error) {
            this.logger.log("ERROR: onComplete " + error);
        }
        return newCompletionList;
    }



    /**
     * until further reworking, onCompletionResolve requires that when a completionBuilderItem() is .build()
     * it it also given the method .kind(FishCompletionItemKind) to set the kind of the item.
     * Not seeing a completion result, with typed correctly is likely caused from this.
     */
    async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        let newDoc: string | MarkupContent;
        const fishItem = item as FishCompletionItem
        if (fishItem.localSymbol == true) return item;
        let [typeCmdOutput, typeofDoc] = ['', '']
        switch (fishItem.fishKind) {
            case FishCompletionItemKind.GLOBAL_FUNCTION: 
            case FishCompletionItemKind.LOCAL_FUNCTION: 
            case FishCompletionItemKind.GLOBAL_VARIABLE:
            case FishCompletionItemKind.LOCAL_VARIABLE:
                return item;
            case FishCompletionItemKind.USER_FUNCTION:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'fish')
                return item;
            case FishCompletionItemKind.GLOBAL_FUNCTION:
            case FishCompletionItemKind.RESOLVE:
                typeCmdOutput = await execCommandType(fishItem.label)
                if (typeCmdOutput != '') {
                    newDoc = await execCommandDocs(fishItem.label)
                    item.documentation = typeCmdOutput === 'file' 
                        ? enrichToCodeBlockMarkdown(newDoc, 'fish') : enrichToCodeBlockMarkdown(newDoc, 'man')
                }
                return item;
            case FishCompletionItemKind.FLAG:
                const line = fishItem.data.line.slice(0, fishItem.data.line.length - fishItem.data.word.length) + item.label
                this.logger.log('line: ' + line);
                item.documentation = await getFlagDocumentationAsMarkup(line)
                return item
            case FishCompletionItemKind.BUILTIN:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
                return item;
            default:
                return item;
        }
    }



    // • lsp-spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_symbol
    // • hierachy of symbols support on line 554: https://github.com/typescript-language-server/typescript-language-server/blob/114d4309cb1450585f991604118d3eff3690237c/src/lsp-server.ts#L554
    //
    // ResolveWorkspaceResult
    // https://github.com/Dart-Code/Dart-Code/blob/master/src/extension/providers/dart_workspace_symbol_provider.ts#L7
    //
    async onDocumentSymbols(params: DocumentSymbolParams): Promise<DocumentSymbol[]> {
        this.logParams('onDocumentSymbols', params);
        const {doc} = this.getDefaultsForPartialParams(params)
        if (!doc) return [];
        return this.analyzer.getDocumentSymbols(doc, 'clientTree')
    }

    protected get supportHierarchicalDocumentSymbol(): boolean {
        const textDocument = this.initializeParams?.capabilities.textDocument;
        const documentSymbol = textDocument && textDocument.documentSymbol;
        return !!documentSymbol && !!documentSymbol.hierarchicalDocumentSymbolSupport;
    }

    async onWorkspaceSymbol(params: WorkspaceSymbolParams): Promise<WorkspaceSymbol[]> {
        this.logParams('onWorkspaceSymbol', params.query);
        return this.analyzer.getWorkspaceSymbols(params.query) || []
    }


    // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#showDocumentParams
    async onDefinition(params: DefinitionParams): Promise<Location[]> {
        this.logParams("onDefinition", params);
        const {doc, uri, root, current} = this.getDefaults(params)
        if (!doc) return [];
        return this.analyzer.getDefinitionLocation(doc, params.position)
    }

    async onReferences(params: ReferenceParams): Promise<Location[]> {
        this.logParams("onReference", params);
        const {doc, uri, root, current} = this.getDefaults(params)
        if (!doc || !uri || !root || !current) return [];
        return getRefrenceLocations(this.analyzer, doc, params.position)
    }

    // opens package.json on hover of document symbol!
    //
    // NEED TO REMOVE documentationCache. It works but is too expensive memory wise.
    // REFACTOR into a procedure that conditionally determines output type needed.
    // Also plan to get rid of any other cache's, so that the garbage collector can do its job. 
    async onHover(params: HoverParams): Promise<Hover | null> {
        this.logParams("onHover", params);
        const {doc, uri, root, current} = this.getDefaults(params)
        if (!doc || !uri || !root || !current) return null;
        const symbolItem = this.analyzer.getHover(doc, params.position)
        if (symbolItem) return symbolItem;
        const globalItem = await this.documentationCache.resolve(current.text.trim(), uri)
        this.logger.log('docCache found '+ globalItem?.resolved.toString() || `docCache not found ${current.text}`)
        if (globalItem && globalItem.docs) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: globalItem.docs
                }
            }
        }
        return await handleHover(doc.uri, root, current, this.documentationCache);
    }

    // workspace.fileOperations.didRename
    // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/#fileEvent
    //applyEdits(params: WorkspaceEdit): void {
    //    this.logParams("applyRenameFile", params);
    //    const changes : ResoucreOperation = params.
    //    for (const change of changes) {
    //        switch (change.kind) {
    //            case 'rename':
    //                this.docs.rename(change.oldUri, change.newUri);
    //                this.analyzer.cache.updateUri(change.oldUri, change.newUri);
    //
    //
    //        }
    //        const newUri = change.
    //    }
    //
    //    return;
    //}

    async onRename(params: RenameParams) : Promise<WorkspaceEdit | null> {
        this.logParams('onRename', params);
        const {doc} = this.getDefaults(params)
        if (!doc) return null;
        return getRenameWorkspaceEdit(this.analyzer, doc, params.position, params.newName)
    }

    async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
        this.logParams(`onDocumentFormatting: ${params.textDocument.uri}`);
        const {doc, uri, root} = this.getDefaultsForPartialParams(params)
        if (!doc || !uri || !root) return [];
        let formattedText: string | null = null
        try {
            formattedText = await execFormatter(uri)
        } catch (err) {
            if (err instanceof Error) {
                this.connection.window.showErrorMessage(err.message)
            }
            if (typeof err === 'string') {
                this.connection.window.showErrorMessage(err)
            }
            return []
        }
        if (!formattedText) return []
        formattedText = applyFormatterSettings(this.parser.parse(formattedText).rootNode, this.config.getFormattingOptions())
        const editedRange = getRange(root)
        this.connection.window.showInformationMessage(`Formatted: ${uri}`)
        return [TextEdit.replace(editedRange, formattedText)]
    }

    async onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]> {
        this.logParams('onDocumentRangeFormatting', params);
        const {doc, uri, root} = this.getDefaultsForPartialParams(params)
        const range = params.range
        if (!doc || !uri || !root) return [];
        let formattedText: string | null = null
        try {
            formattedText = await execFormatter(uri)
        } catch (err) {
            if (err instanceof Error) {
                this.connection.window.showErrorMessage(err.message)
            }
            if (typeof err === 'string') {
                this.connection.window.showErrorMessage(err)
            }
            return []
        }
        if (!formattedText) return []
        formattedText = applyFormatterSettings(this.parser.parse(formattedText).rootNode, this.config.getFormattingOptions())
        //formattedText = formattedText.split('\n').slice(range.start.line, range.end.line).join('\n') + '\n'
        this.connection.window.showInformationMessage(`Formatted Range: ${uri}`)
        return [TextEdit.replace(range, applyFormattedTextInRange(formattedText, range))]
    }

    protected async getCodeFixes(fileRangeArgs: FishProtocol.FileRangeRequestArgs, context: LSP.CodeActionContext): Promise<FishProtocol.GetCodeFixesResponse | undefined> {
        const errorCodes = context.diagnostics.map(diagnostic => Number(diagnostic.code));
        const args: FishProtocol.CodeFixRequestArgs = {
            ...fileRangeArgs,
            errorCodes,
        };
        try {
            return await this.connection.sendRequest(FishProtocol.CommandTypes.GetCodeFixes, args);
        } catch (err) {
            return undefined;
        }
    }
    protected async getRefactors(fileRangeArgs: FishProtocol.FileRangeRequestArgs, context: LSP.CodeActionContext): Promise<FishProtocol.GetApplicableRefactorsResponse | undefined> {
        const args: FishProtocol.GetApplicableRefactorsRequestArgs = {
            ...fileRangeArgs,
            triggerReason: context.triggerKind === LSP.CodeActionTriggerKind.Invoked ? 'invoked' : undefined,
            kind: context.only?.length === 1 ? context.only[0] : undefined,
        };
        try {
            return await this.connection.sendRequest(FishProtocol.CommandTypes.GetApplicableRefactors, args);
        } catch (err) {
            return undefined;
        }
    }

    async onFoldingRanges(params: FoldingRangeParams): Promise<FoldingRange[] | undefined> {
        this.logParams('onFoldingRanges', params);

        const file = uriToPath(params.textDocument.uri);
        const document = this.docs.get(file);

        if (!document) {
            throw new Error(`The document should not be opened in the folding range, file: ${file}`)
        }
        //this.analyzer.analyze(document)
        const symbols = this.analyzer.getDocumentSymbols(document)
        const flatSymbols = FishDocumentSymbol.toTree(symbols).toFlatArray()
        this.logger.logPropertiesForEachObject(flatSymbols.filter(s => s.kind === SymbolKind.Function), 'name', 'range')
        const folds = flatSymbols
            .filter(symbol => symbol.kind === SymbolKind.Function)
            .map(symbol => FishDocumentSymbol.toFoldingRange(symbol))

        folds.forEach(fold => {
            this.logger.log({fold})
        })


        return folds
    }

    async onCodeAction(params: CodeActionParams) : Promise<CodeAction[]> {
        const uri = uriToPath(params.textDocument.uri)
        const document = this.docs.get(uri);
        //this.logger.log(JSON.stringify({params}))
        if (!uri || !document) return []
        const root = this.parser.parse(document.getText()).rootNode;
        const results: CodeAction[]  = []
        for (const diagnostic of params.context.diagnostics) {
            const res = handleConversionToCodeAction(diagnostic, root, document)
            if (res) results.push(res)
        }
        return results
    }

    // works but is super slow and resource intensive, plus it doesn't really display much
    async onInlayHints(params: InlayHintParams) {
        return await FishShellInlayHintsProvider.provideInlayHints(
            params.textDocument.uri,
            params.range,
            this.docs,
            this.analyzer,
            this.config
        );

    }

    /////////////////////////////////////////////////////////////////////////////////////
    // HELPERS
    /////////////////////////////////////////////////////////////////////////////////////
    
    /**
     * Logs the params passed into a handler
     *
     * @param {string} methodName - the FishLsp method name that was called
     * @param {any[]} params - the params passed into the method
     */
    private logParams(methodName: string, ...params: any[]) {
        this.logger.log({handler: methodName, params})
    }


    // helper to get all the default objects needed when a TextDocumentPositionParam is passed
    // into a handler
    private getDefaults(params: TextDocumentPositionParams) : {
        doc?: LspDocument,
        uri?: string,
        root?: SyntaxNode | null,
        current?: SyntaxNode | null,
    } {
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        if (!doc || !uri) return {};
        const root = this.analyzer.getRootNode(doc)
        const current = this.analyzer.nodeAtPoint(doc.uri, params.position.line, params.position.character);
        return {doc, uri, root, current}
    }

    private getDefaultsForPartialParams(params: {textDocument: TextDocumentIdentifier}) : {
        doc?: LspDocument,
        uri?: string,
        root?: SyntaxNode | null,
    } {
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        const root = doc ? this.analyzer.getRootNode(doc) : undefined
        return {doc, uri, root}
    }

    private async startBackgroundAnalysis(): Promise<{ filesParsed: number }> {
        const notifyCallback = (text: string) => this.connection.window.showInformationMessage(text)
        return this.analyzer.initiateBackgroundAnalysis(notifyCallback)
    }
}