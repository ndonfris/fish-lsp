// Import polyfills for Node.js 18 compatibility
import './utils/array-polyfills';
// Initialize virtual filesystem (must be before any embedded asset usage)
import './virtual-fs';
import { SyntaxNode } from 'web-tree-sitter';
import { AnalyzedDocument, analyzer, Analyzer } from './analyze';
import { InitializeParams, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, DocumentRangeFormattingParams, FoldingRangeParams, FoldingRange, InlayHintParams, MarkupKind, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, CompletionTriggerKind, SignatureHelpParams, SignatureHelp, ImplementationParams, CodeLensParams, CodeLens, WorkspaceFoldersChangeEvent, SelectionRangeParams, SelectionRange } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { LspDocument, documents } from './document';
import { formatDocumentWithIndentComments, formatDocumentContent } from './formatting';
import { createServerLogger, logger } from './logger';
import { connection, createBrowserConnection, setExternalConnection } from './utils/startup';
import { formatTextWithIndents, symbolKindsFromNode, uriToPath } from './utils/translation';
import { getChildNodes } from './utils/tree-sitter';
import { getVariableExpansionDocs, handleHover } from './hover';
import { DocumentationCache, initializeDocumentationCache } from './utils/documentation-cache';
import { getWorkspacePathsFromInitializationParams, initializeDefaultFishWorkspaces } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { formatFishSymbolTree, filterLastPerScopeSymbol, FishSymbol } from './parsing/symbol';
import { CompletionPager, initializeCompletionPager, SetupData } from './utils/completion/pager';
import { FishCompletionItem } from './utils/completion/types';
import { getDocumentationResolver } from './utils/completion/documentation';
import { FishCompletionList } from './utils/completion/list';
import { PrebuiltDocumentationMap, getPrebuiltDocUrl } from './utils/snippets';
import { findParent, findParentCommand, isAliasDefinitionName, isBraceExpansion, isCommand, isConcatenatedValue, isConcatenation, isEndStdinCharacter, isOption, isReturnStatusNumber, isVariableDefinition } from './utils/node-types';
import { config, Config, configHandlers } from './config';
import { enrichToMarkdown, handleBraceExpansionHover, handleEndStdinHover, handleSourceArgumentHover } from './documentation';
import { findActiveParameterStringRegex, getAliasedCompletionItemSignature, getDefaultSignatures, getFunctionSignatureHelp, isRegexStringSignature } from './signature';
import { CompletionItemMap } from './utils/completion/startup-cache';
import { getDocumentHighlights } from './document-highlight';
import { semanticTokensHandlerCallback } from './semantic-tokens';
import { buildCommentCompletions } from './utils/completion/comment-completions';
import { codeActionHandlers } from './code-actions/code-action-handler';
import { createExecuteCommandHandler } from './command';
import { getAllInlayHints } from './inlay-hints';
import { setupProcessEnvExecFile } from './utils/process-env';
import { flattenNested } from './utils/flatten';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { isSourceCommandArgumentName } from './parsing/source';
import { getReferences } from './references';
import { getRenames } from './renames';
import { getReferenceCountCodeLenses } from './code-lens';
import { getSelectionRanges } from './selection-range';
// import { getLinkedEditingRanges } from './linked-editing';
import { PkgJson } from './utils/commander-cli-subcommands';

export type SupportedFeatures = {
  codeActionDisabledSupport: boolean;
};

/**
 * The globally accessible configuration setting. Set from the client, and used by the server.
 * When enabled, the analyzer will search through the current workspace, and update it's
 * cache of symbols only within the current workspace. When disabled, the analyzer will have
 * to search through all workspaces.
 *
 * Also, this setting is used to determine if the initializationResult.workspace.workspaceFolders
 * should be enabled or disabled.
 */
export let hasWorkspaceFolderCapability = false;
export const enableWorkspaceFolderSupport = () => {
  hasWorkspaceFolderCapability = true;
};

export let currentDocument: LspDocument | null = null;

type WebServerProps = {
  connection?: Connection;
  params?: InitializeParams;
};

export default class FishServer {
  public static async createWebServer(props: WebServerProps): Promise<{
    server: FishServer;
    initializeResult: InitializeResult;
  }> {
    const connection = props.connection || createBrowserConnection();
    logger.info(`(${new Date().toISOString()}) FishServer.createWebServer()`, {
      version: PkgJson.version,
      buildTime: PkgJson.buildTime,
      props,
    });

    Config.isWebServer = true;

    if (!props.params) {
      props.params = {
        processId: 0,
        rootUri: null,
        rootPath: null,
        capabilities: {},
        initializationOptions: {},
        workspaceFolders: [],
      } as InitializeParams;
    }
    connection.onInitialize(
      async (params: InitializeParams): Promise<InitializeResult> => {
        const { initializeResult } = await FishServer.create(connection, params);
        Config.isWebServer = true;
        return initializeResult;
      },
    );

    // Start listening
    connection.listen();

    // Setup logger
    createServerLogger(config.fish_lsp_log_file, connection.console);
    logger.log('Starting FISH-LSP server');
    logger.log('Server started with the following handlers:', configHandlers);
    logger.log('Server started with the following config:', config);

    return await FishServer.create(connection, props.params);
  }

  /**
   * How a client importing the server as a module would connect to a new server instance
   *
   * After a connection is created by the client this method will setup the server
   * to allow the connection to communicate between the client and server.
   *
   * Use this method for standard LSP server implementations, for in browser usage
   * the `FishServer.createWebServer()` method is provided.
   * ___
   *
   * @example
   * ```ts
   * import FishServer from 'fish-lsp';
   * import {
   *   createConnection,
   *   InitializeParams,
   *   InitializeResult,
   *   ProposedFeatures,
   * } from 'vscode-languageserver/node';
   *
   * const connection = createConnection(ProposedFeatures.all)
   *
   * connection.onInitialize(
   *   async (params: InitializeParams): Promise<InitializeResult> => {
   *     const { initializeResult } = await FishServer.create(connection, params);
   *
   *     return initializeResult;
   *   },
   * );
   * connection.listen();
   * ```
   * ___
   *
   * @param connection The LSP connection to use
   * @param params The initialization parameters from the client
   * @returns The created FishServer instance and the initialization result
   */
  public static async create(
    connection: Connection,
    params: InitializeParams,
  ): Promise<{ server: FishServer; initializeResult: InitializeResult; }> {
    setExternalConnection(connection);
    await setupProcessEnvExecFile();
    const capabilities = params.capabilities;
    const initializeResult = Config.initialize(params, connection);
    logger.log({
      server: 'FishServer',
      rootUri: params.rootUri,
      rootPath: params.rootPath,
      workspaceFolders: params.workspaceFolders,
    });

    // set this only it it hasn't been set yet
    hasWorkspaceFolderCapability = !!(
      !!capabilities?.workspace && !!capabilities?.workspace.workspaceFolders
    );
    logger.debug('hasWorkspaceFolderCapability', hasWorkspaceFolderCapability);

    const initializeUris = getWorkspacePathsFromInitializationParams(params);
    logger.info('initializeUris', initializeUris);

    // Run these operations in parallel rather than sequentially
    const [
      cache,
      _workspaces,
      completionsMap,
    ] = await Promise.all([
      initializeDocumentationCache(),
      initializeDefaultFishWorkspaces(...initializeUris),
      CompletionItemMap.initialize(),
    ]);

    await Analyzer.initialize();

    const completions = await initializeCompletionPager(logger, completionsMap);

    const server = new FishServer(
      completions,
      completionsMap,
      cache,
      params,
    );
    server.register(connection);
    return { server, initializeResult };
  }

  protected features: SupportedFeatures;
  public clientSupportsShowDocument: boolean;
  public backgroundAnalysisComplete: boolean;

  constructor(
    private completion: CompletionPager,
    private completionMap: CompletionItemMap,
    private documentationCache: DocumentationCache,
    private initializeParams: InitializeParams,

  ) {
    this.features = { codeActionDisabledSupport: true };
    this.clientSupportsShowDocument = false;
    this.backgroundAnalysisComplete = false;
  }

  /**
   * Bind the connection handlers to their corresponding methods in the
   * server so that `server.create()` initializes the server with all handlers
   * enabled.
   *
   * The `src/config.ts` file handles dynamic enabling/disabling of these
   * handlers based on client capabilities and user configuration.
   *
   * @see Config.getResultCapabilities for the capabilities negotiated
   *
   * @param connection The LSP connection to register handlers on
   * @returns void
   */
  register(connection: Connection): void {
    // setup handlers
    const { onCodeAction } = codeActionHandlers(documents, analyzer);
    const documentHighlightHandler = getDocumentHighlights(analyzer);
    // Semantic tokens handler using tree-sitter queries
    const { semanticTokensHandler, semanticTokensRangeHandler } = semanticTokensHandlerCallback();
    const commandCallback = createExecuteCommandHandler(connection, documents, analyzer);

    // register the handlers
    connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this));
    connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this));

    connection.onCompletion(this.onCompletion.bind(this));
    connection.onCompletionResolve(this.onCompletionResolve.bind(this));

    connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
    connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));
    connection.onWorkspaceSymbolResolve(this.onWorkspaceSymbolResolve.bind(this));

    connection.onDefinition(this.onDefinition.bind(this));
    connection.onImplementation(this.onImplementation.bind(this));
    connection.onReferences(this.onReferences.bind(this));
    connection.onHover(this.onHover.bind(this));

    connection.onRenameRequest(this.onRename.bind(this));

    connection.onDocumentFormatting(this.onDocumentFormatting.bind(this));
    connection.onDocumentRangeFormatting(this.onDocumentRangeFormatting.bind(this));
    connection.onDocumentOnTypeFormatting(this.onDocumentTypeFormatting.bind(this));
    connection.onCodeAction(onCodeAction);

    connection.onCodeLens(this.onCodeLens.bind(this));
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));
    connection.onSelectionRanges(this.onSelectionRanges.bind(this));

    connection.onDocumentHighlight(documentHighlightHandler);
    connection.languages.inlayHint.on(this.onInlayHints.bind(this));
    connection.languages.semanticTokens.on(semanticTokensHandler);
    connection.languages.semanticTokens.onRange(semanticTokensRangeHandler);

    connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));
    connection.onExecuteCommand(commandCallback);

    // connection.languages.onLinkedEditingRange(this.onLinkedEditingRange.bind(this));

    connection.onInitialized(this.onInitialized.bind(this));
    connection.onShutdown(this.onShutdown.bind(this));

    logger.log({ 'server.register': 'registered' });
  }

  async didOpenTextDocument(params: LSP.DidOpenTextDocumentParams) {
    this.logParams('didOpenTextDocument', params);
    const path = uriToPath(params.textDocument.uri);
    const doc = documents.openPath(path, params.textDocument);
    workspaceManager.handleOpenDocument(doc);
    currentDocument = doc;
    this.analyzeDocument({ uri: doc.uri });
    workspaceManager.handleUpdateDocument(doc);
    if (workspaceManager.needsAnalysis() && workspaceManager.allAnalysisDocuments().length > 0) {
      const progress = await connection.window.createWorkDoneProgress();
      progress.begin('[fish-lsp] analysis');
      await workspaceManager.analyzePendingDocuments(progress, (str) => logger.info('didOpen', str));
      progress.done();
    }
    analyzer.diagnostics.setInitial(doc.uri);
  }

  async didChangeTextDocument(params: LSP.DidChangeTextDocumentParams): Promise<void> {
    this.logParams('didChangeTextDocument', params);

    const progress = await connection.window.createWorkDoneProgress();
    const path = uriToPath(params.textDocument.uri);
    let doc = documents.get(path);
    if (!doc) {
      doc = analyzer.analyzePath(path)?.document;
    }
    if (!doc) {
      logger.warning('didChangeTextDocument: document not found', { path });
      return;
    }

    // update the document with the changes
    currentDocument = doc;
    documents.applyChanges(params.textDocument.uri, params.contentChanges);

    // Force fresh analysis by bypassing cache for changed documents
    const analysisResult = this.analyzeDocument({ uri: doc.uri }, true);

    // Ensure diagnostics were sent
    logger.log('Document analysis completed:', {
      uri: doc.uri,
      analysisResult: !!analysisResult,
    });

    await workspaceManager.analyzePendingDocuments();
    progress.done();
    analyzer.diagnostics.set(doc.uri);
  }

  didCloseTextDocument(params: LSP.DidCloseTextDocumentParams): void {
    this.logParams('didCloseTextDocument', params);
    workspaceManager.handleCloseDocument(params.textDocument.uri);
    analyzer.diagnostics.delete(params.textDocument.uri);
    // Clean up global symbols for the closed document
    analyzer.removeDocumentSymbols(params.textDocument.uri);
  }

  async didSaveTextDocument(params: LSP.DidSaveTextDocumentParams): Promise<void> {
    this.logParams('didSaveTextDocument', params);
    // this.clearDiagnostics({ uri: params.textDocument.uri });
    const path = uriToPath(params.textDocument.uri);
    let doc = documents.get(path);
    if (!doc && params.text) {
      doc = LspDocument.createTextDocumentItem(params.textDocument.uri, params.text || '');
      documents.set(doc);
    } else if (!doc) {
      this.analyzeDocument({ uri: params.textDocument.uri });
      return;
    }
    // this.clearDiagnostics({uri: params.textDocument.uri})
    this.analyzeDocument({ uri: doc.uri });
    workspaceManager.handleOpenDocument(doc);
    workspaceManager.handleUpdateDocument(doc);
    await workspaceManager.analyzePendingDocuments();
    analyzer.diagnostics.setInitial(doc.uri);
  }

  /**
   * Stop the server and close all workspaces.
   */
  async onShutdown() {
    analyzer.diagnostics.clear();
    workspaceManager.clear();
    documents.clear();
    currentDocument = null;
    this.backgroundAnalysisComplete = false;
  }

  /**
   * Called after the server.onInitialize() handler, dynamically registers
   * the onDidChangeWorkspaceFolders handler if the client supports it.
   * It will also try to analyze the current workspaces' pending documents.
   */
  async onInitialized(params: any): Promise<{ result: number; }> {
    logger.log('onInitialized', params);
    if (hasWorkspaceFolderCapability) {
      connection.workspace.onDidChangeWorkspaceFolders(event => {
        logger.info({
          'connection.workspace.onDidChangeWorkspaceFolders': 'analyzer.onInitialized',
          added: event.added.map(folder => folder.name),
          removed: event.removed.map(folder => folder.name),
          hasWorkspaceFolderCapability: hasWorkspaceFolderCapability,
        });
        this.handleWorkspaceFolderChanges(event);
      });
    }
    const result = await connection.window.createWorkDoneProgress().then(async (progress) => {
      progress.begin('[fish-lsp] analyzing workspaces');
      const { totalDocuments } = await workspaceManager.analyzePendingDocuments(progress, (str) => logger.info('onInitialized', str));
      progress.done();
      this.backgroundAnalysisComplete = true;
      return totalDocuments;
    });
    return {
      result,
    };
  }

  private async handleWorkspaceFolderChanges(event: WorkspaceFoldersChangeEvent) {
    this.logParams('handleWorkspaceFolderChanges', event);
    // Show progress for added workspaces
    const progress = await connection.window.createWorkDoneProgress();
    progress.begin(`[fish-lsp] analyzing workspaces [${event.added.map(s => s.name).join(',')}] added`);
    workspaceManager.handleWorkspaceChangeEvent(event, progress);
    workspaceManager.analyzePendingDocuments(progress);
  }

  onCommand(params: LSP.ExecuteCommandParams): Promise<any> {
    const callback = createExecuteCommandHandler(connection, documents, analyzer);
    return callback(params);
  }

  // @TODO: REFACTOR THIS OUT OF SERVER
  // https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
  // https://github.com/microsoft/vscode-languageserver-node/pull/322
  // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextModehttps://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextMode
  // • clean up into completion.ts file & Decompose to state machine, with a function that gets the state machine in this class.
  //         DART is best example i've seen for this.
  //         ~ https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202 ~
  // • Implement both escapedCompletion script and dump syntax tree script
  // • Add default CompletionLists to complete.ts
  // • Add local file items.
  // • Lastly add parameterInformation items.  [ 1477 : ParameterInformation ]
  // convert to CompletionItem[]
  async onCompletion(params: CompletionParams): Promise<CompletionList> {
    this.logParams('onCompletion', params);
    if (!this.backgroundAnalysisComplete) {
      return await this.completion.completeEmpty([]);
    }

    const { doc, path, current } = this.getDefaults(params);
    let list: FishCompletionList = FishCompletionList.empty();

    if (!path || !doc) {
      logger.logAsJson('onComplete got [NOT FOUND]: ' + path);
      return this.completion.empty();
    }
    const symbols = analyzer.allSymbolsAccessibleAtPosition(doc, params.position);
    const { line, word } = analyzer.parseCurrentLine(doc, params.position);
    logger.log({
      symbols: symbols.map(s => s.name),
    });

    if (!line) return await this.completion.completeEmpty(symbols);

    const fishCompletionData = {
      uri: doc.uri,
      position: params.position,
      context: {
        triggerKind: params.context?.triggerKind || CompletionTriggerKind.Invoked,
        triggerCharacter: params.context?.triggerCharacter,
      },
    } as SetupData;

    try {
      if (line.trim().startsWith('#') && current) {
        logger.log('completeComment');
        return buildCommentCompletions(line, params.position, current, fishCompletionData, word);
      }
      if (word.trim().endsWith('$') || line.trim().endsWith('$') || word.trim() === '$' && !word.startsWith('$$')) {
        logger.log('completeVariables');
        return this.completion.completeVariables(line, word, fishCompletionData, symbols);
      }
    } catch (error) {
      logger.warning('ERROR: onComplete ' + error?.toString() || 'error');
    }

    try {
      logger.log('complete');
      list = await this.completion.complete(line, fishCompletionData, symbols);
    } catch (error) {
      logger.logAsJson('ERROR: onComplete ' + error?.toString() || 'error');
    }
    return list;
  }

  /**
   * until further reworking, onCompletionResolve requires that when a completionBuilderItem() is .build()
   * it it also given the method .kind(FishCompletionItemKind) to set the kind of the item.
   * Not seeing a completion result, with typed correctly is likely caused from this.
   */
  async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
    const fishItem = item as FishCompletionItem;
    logger.log({ onCompletionResolve: fishItem });
    try {
      if (fishItem.useDocAsDetail || fishItem.local) {
        item.documentation = {
          kind: MarkupKind.Markdown,
          value: fishItem.documentation.toString(),
        };
        return item;
      }
      const doc = await getDocumentationResolver(fishItem);
      if (doc) {
        item.documentation = doc as MarkupContent;
      }
    } catch (err) {
      logger.error('onCompletionResolve', err);
    }
    return item;
  }

  // • lsp-spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_symbol
  // • hierarchy of symbols support on line 554: https://github.com/typescript-language-server/typescript-language-server/blob/114d4309cb1450585f991604118d3eff3690237c/src/lsp-server.ts#L554
  //
  // ResolveWorkspaceResult
  // https://github.com/Dart-Code/Dart-Code/blob/master/src/extension/providers/dart_workspace_symbol_provider.ts#L7
  //
  onDocumentSymbols(params: DocumentSymbolParams): DocumentSymbol[] {
    this.logParams('onDocumentSymbols', params);

    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    // Get local document symbols
    const localSymbols = analyzer.cache.getDocumentSymbols(doc.uri);

    // Get sourced symbols and convert them to nested structure if needed
    const sourcedSymbols = analyzer.collectSourcedSymbols(doc.uri);

    // Combine local and sourced symbols and cache the sourced symbols as global definitions
    // local to the document inside the analyzer workspace. Heuristic to cache global symbols
    // more frequently in background analysis of focused document because server.onDocumentSymbols
    // is requested repeatedly in most clients when moving around a LspDocument.
    [...localSymbols, ...sourcedSymbols]
      .filter(s => s.isGlobal() || s.isRootLevel())
      .forEach(s => analyzer.globalSymbols.add(s));

    return filterLastPerScopeSymbol(localSymbols)
      .map(s => s.toDocumentSymbol())
      .filter(s => !!s);
  }

  public get supportHierarchicalDocumentSymbol(): boolean {
    const textDocument = this.initializeParams?.capabilities.textDocument;
    const documentSymbol = textDocument && textDocument.documentSymbol;
    return (
      !!documentSymbol &&
      !!documentSymbol.hierarchicalDocumentSymbolSupport
    );
  }

  async onWorkspaceSymbol(params: WorkspaceSymbolParams): Promise<WorkspaceSymbol[]> {
    this.logParams('onWorkspaceSymbol', params.query);

    const symbols: FishSymbol[] = [];
    const workspace = workspaceManager.current;
    for (const uri of workspace?.allUris || []) {
      const newSymbols = [
        ...analyzer.cache.getDocumentSymbols(uri),
        ...analyzer.collectSourcedSymbols(uri),
      ];
      symbols.push(...filterLastPerScopeSymbol(newSymbols));
    }

    logger.log('symbols', {
      uris: workspace?.allUris,
      symbols: symbols.map(s => s.name),
    });
    return analyzer.getWorkspaceSymbols(params.query) || [];
  }

  /**
   * Resolve a workspace symbol to its full definition.
   */
  async onWorkspaceSymbolResolve(symbol: WorkspaceSymbol): Promise<WorkspaceSymbol> {
    this.logParams('onWorkspaceSymbolResolve', symbol);
    const { uri } = symbol.location;
    const foundSymbol = analyzer.getFlatDocumentSymbols(uri)
      .find(s => s.name === symbol.name && s.isGlobal());
    if (foundSymbol) {
      return {
        ...foundSymbol.toWorkspaceSymbol(),
        ...foundSymbol.toDocumentSymbol(),
      };
    }
    // This is a no-op, as we don't have any additional information to resolve.
    // In the future, we could add more information to the symbol if needed.
    return symbol;
  }

  // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#showDocumentParams
  async onDefinition(params: DefinitionParams): Promise<Location[]> {
    this.logParams('onDefinition', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return [];

    const newDefs = analyzer.getDefinitionLocation(doc, params.position);
    for (const location of newDefs) {
      workspaceManager.handleOpenDocument(location.uri);
      workspaceManager.handleUpdateDocument(location.uri);
    }
    if (workspaceManager.needsAnalysis()) {
      await workspaceManager.analyzePendingDocuments();
    }
    return newDefs;
  }

  async onReferences(params: ReferenceParams): Promise<Location[]> {
    this.logParams('onReference', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return [];

    const progress = await connection.window.createWorkDoneProgress();

    const defSymbol = analyzer.getDefinition(doc, params.position);
    if (!defSymbol) {
      logger.log('onReferences: no definition found at position', params.position);
      return [];
    }

    const results = getReferences(defSymbol.document, defSymbol.toPosition(), {
      reporter: progress,
    });

    logger.info({
      onReferences: 'found references',
      uri: defSymbol.uri,
      count: results.length,
      position: params.position,
      symbol: defSymbol.name,
    });

    if (results.length === 0) {
      logger.warning('onReferences: no references found', { uri: params.textDocument.uri, position: params.position });
      return [];
    }
    return results;
  }

  /**
   * bi-directional lookup of completion <-> definition under cursor location.
   */
  async onImplementation(params: ImplementationParams): Promise<Location[]> {
    this.logParams('onImplementation', params);
    const { doc } = this.getDefaults(params);
    if (!doc) return [];
    const symbols = analyzer.cache.getDocumentSymbols(doc.uri);
    const lastSymbols = filterLastPerScopeSymbol(symbols);
    logger.log('symbols', formatFishSymbolTree(lastSymbols));
    const result = analyzer.getImplementation(doc, params.position);
    logger.log('implementationResult', { result });
    return result;
  }

  // Probably should move away from `documentationCache`. It works but is too expensive memory wise.
  // REFACTOR into a procedure that conditionally determines output type needed.
  // Also plan to get rid of any other cache's, so that the garbage collector can do its job.
  async onHover(params: HoverParams): Promise<Hover | null> {
    this.logParams('onHover', params);
    const { doc, path, root, current } = this.getDefaults(params);
    if (!doc || !path || !root || !current) {
      return null;
    }

    let result: Hover | null = null;
    if (isSourceCommandArgumentName(current)) {
      result = handleSourceArgumentHover(analyzer, current, doc);
      if (result) return result;
    }

    if (current.parent && isSourceCommandArgumentName(current.parent)) {
      result = handleSourceArgumentHover(analyzer, current.parent, doc);
      if (result) return result;
    }

    if (isAliasDefinitionName(current)) {
      result = analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      if (result) return result;
    }

    if (isArgparseVariableDefinitionName(current)) {
      logger.log('isArgparseDefinition');
      result = analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      return result;
    }

    if (isOption(current)) {
      // check that we aren't hovering a function option that is defined by
      // argparse inside the function, if we are then return it's hover value
      result = analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      if (result) return result;
      // otherwise we get the hover using inline documentation from `complete --do-complete {option}`
      result = await handleHover(
        analyzer,
        doc,
        params.position,
        current,
        this.documentationCache,
      );
      if (result) return result;
    }

    if (isConcatenatedValue(current)) {
      logger.log('isConcatenatedValue', { text: current.text, type: current.type });
      const parent = findParent(current, isConcatenation);
      const brace = findParent(current, isBraceExpansion);
      if (parent) {
        const res = await handleBraceExpansionHover(parent);
        if (res) return res;
      }
      if (brace) {
        const res = await handleBraceExpansionHover(brace);
        if (res) return res;
      }
    }
    // handle brace expansion hover
    if (isBraceExpansion(current)) {
      logger.log('isBraceExpansion', { text: current.text, type: current.type });
      const res = await handleBraceExpansionHover(current);
      if (res) return res;
    }
    if (current.parent && isBraceExpansion(current.parent)) {
      logger.log('isBraceExpansion: parent', { text: current.parent.text, type: current.parent.type });
      const res = await handleBraceExpansionHover(current.parent);
      if (res) return res;
    }

    if (isEndStdinCharacter(current)) {
      return handleEndStdinHover(current);
    }

    const { kindType, kindString } = symbolKindsFromNode(current);
    logger.log({ currentText: current.text, currentType: current.type, symbolKind: kindString });

    const prebuiltSkipType = [
      ...PrebuiltDocumentationMap.getByType('pipe'),
      ...isReturnStatusNumber(current) ? PrebuiltDocumentationMap.getByType('status') : [],
    ].find(obj => obj.name === current.text);

    // documentation for prebuilt variables without definition's
    // including $status, $pipestatus, $fish_pid, etc.
    // See: PrebuiltDocumentationMap.getByType('variable') for entire list
    // Also includes autoloaded variables: $fish_complete_path, $__fish_data_dir, etc...
    const isPrebuiltVariableWithoutDefinition = getVariableExpansionDocs(analyzer, doc, params.position);
    const prebuiltHover = isPrebuiltVariableWithoutDefinition(current);
    if (prebuiltHover) return prebuiltHover;

    const symbolItem = analyzer.getHover(doc, params.position);
    if (symbolItem) return symbolItem;
    if (prebuiltSkipType) {
      return {
        contents: enrichToMarkdown([
          `___${current.text}___  - _${getPrebuiltDocUrl(prebuiltSkipType)}_`,
          '___',
          `type - __(${prebuiltSkipType.type})__`,
          '___',
          `${prebuiltSkipType.description}`,
        ].join('\n')),
      };
    }

    const definition = analyzer.getDefinition(doc, params.position);
    const allowsGlobalDocs = !definition || definition?.isGlobal();
    const symbolType = [
      'function',
      'class',
      'variable',
    ].includes(kindString) ? kindType : undefined;

    const globalItem = await this.documentationCache.resolve(
      current.text.trim(),
      path,
      symbolType,
    );

    logger.log(`this.documentationCache.resolve() found ${!!globalItem}`, { docs: globalItem.docs });
    if (globalItem && globalItem.docs && allowsGlobalDocs) {
      logger.log(globalItem.docs);
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: globalItem.docs,
        },
      };
    }
    const fallbackHover = await handleHover(
      analyzer,
      doc,
      params.position,
      current,
      this.documentationCache,
    );
    logger.log(fallbackHover?.contents);
    return fallbackHover;
  }

  async onRename(params: RenameParams): Promise<WorkspaceEdit | null> {
    this.logParams('onRename', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return null;

    const locations = getRenames(doc, params.position, params.newName);

    const changes: { [uri: string]: TextEdit[]; } = {};
    for (const location of locations) {
      const range = location.range;
      const uri = location.uri;
      const edits = changes[uri] || [];
      edits.push(TextEdit.replace(range, location.newText));
      changes[uri] = edits;
    }
    const workspaceEdit: WorkspaceEdit = {
      changes,
    };
    return workspaceEdit;
  }

  async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentFormatting', params);

    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const formattedText = await formatDocumentWithIndentComments(doc).catch(error => {
      if (config.fish_lsp_show_client_popups) {
        connection.window.showErrorMessage(`Failed to format document: ${error}`);
      }
      return doc.getText(); // fallback to original text on error
    });

    return [{
      range: LSP.Range.create(
        LSP.Position.create(0, 0),
        LSP.Position.create(Number.MAX_VALUE, Number.MAX_VALUE),
      ),
      newText: formattedText,
    }];
  }

  async onDocumentTypeFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentTypeFormatting', params);
    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const formattedText = await formatDocumentWithIndentComments(doc).catch(error => {
      connection.console.error(`Formatting error: ${error}`);
      if (config.fish_lsp_show_client_popups) {
        connection.window.showErrorMessage(`Failed to format document: ${error}`);
      }
      return doc.getText(); // fallback to original text on error
    });

    return [{
      range: LSP.Range.create(
        LSP.Position.create(0, 0),
        LSP.Position.create(Number.MAX_VALUE, Number.MAX_VALUE),
      ),
      newText: formattedText,
    }];
  }
  /**
   * Currently only works for whole line selections, in the future we should try to make every
   * selection a whole line selection.
   */
  async onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentRangeFormatting', params);
    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const range = params.range;
    const startOffset = doc.offsetAt(range.start);
    const endOffset = doc.offsetAt(range.end);

    // get the text
    const originalText = doc.getText();
    const selectedText = doc.getText().slice(startOffset, endOffset).trimStart();

    // Call the formatter 2 differently times, once for the whole document (to get the indentation level)
    // and a second time to get the specific range formatted
    const allText = await formatDocumentContent(originalText).catch((error) => {
      logger.error(`FormattingRange error: ${error}`);
      return selectedText; // fallback to original text on error
    });

    const formattedText = await formatDocumentContent(selectedText).catch(error => {
      logger.error(`FormattingRange error: ${error}`, {
        input: selectedText,
        range: range,
      });
      if (config.fish_lsp_show_client_popups) {
        connection.window.showErrorMessage(`Failed to format range: ${params.textDocument.uri}`);
      }
      return selectedText;
    });

    // Create a temporary TextDocumentItem with the formatted text, for passing to formatTextWithIndents()
    const newDoc = LspDocument.createTextDocumentItem(doc.uri, allText);

    // fixup formatting, so that we end with a single newline character (important for inserting `TextEdit`)
    const output = formatTextWithIndents(
      newDoc,
      range.start.line,
      formattedText.trim(),
    ) + '\n';
    return [
      TextEdit.replace(
        params.range,
        output,
      ),
    ];
  }
  async onFoldingRanges(params: FoldingRangeParams): Promise<FoldingRange[] | undefined> {
    this.logParams('onFoldingRanges', params);

    const { path, doc } = this.getDefaultsForPartialParams(params);

    if (!doc) {
      throw new Error(`The document should not be opened in the folding range, file: ${path}`);
    }

    //this.analyzer.analyze(document)
    const symbols = analyzer.getDocumentSymbols(doc.uri);
    const flatSymbols = flattenNested(...symbols);
    logger.logPropertiesForEachObject(
      flatSymbols.filter((s) => s.kind === SymbolKind.Function),
      'name',
      'range',
    );

    const folds = flatSymbols
      .filter((symbol) => symbol.kind === SymbolKind.Function)
      .map((symbol) => symbol.toFoldingRange());

    folds.forEach((fold) => logger.log({ fold }));

    return folds;
  }

  async onSelectionRanges(params: SelectionRangeParams): Promise<SelectionRange[] | null> {
    this.logParams('onSelectionRanges', params);

    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) {
      return null;
    }

    return getSelectionRanges(doc, params.positions);
  }

  // async onLinkedEditingRange(params: LSP.LinkedEditingRangeParams): Promise<LSP.LinkedEditingRanges | null> {
  //   this.logParams('onLinkedEditingRange', params);
  //
  //   const { doc } = this.getDefaults(params);
  //   if (!doc) return null;
  //
  //   return getLinkedEditingRanges(doc, params.position);
  // }

  // works but is super slow and resource intensive, plus it doesn't really display much
  async onInlayHints(params: InlayHintParams) {
    logger.log({ params });

    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    return getAllInlayHints(analyzer, doc);
  }

  // https://code.visualstudio.com/api/language-extensions/programmatic-language-features#codelens-show-actionable-context-information-within-source-code
  async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
    logger.log('onCodeLens', params);

    const path = uriToPath(params.textDocument.uri);
    const doc = documents.get(path);

    if (!doc) return [];

    return getReferenceCountCodeLenses(analyzer, doc);
  }

  public onShowSignatureHelp(params: SignatureHelpParams): SignatureHelp | null {
    try {
      this.logParams('onShowSignatureHelp', params);
      const { doc, path } = this.getDefaults(params);
      if (!doc || !path) return null;

      const { line, lineRootNode, lineLastNode } = analyzer.parseCurrentLine(doc, params.position);
      if (line.trim() === '') return null;

      const currentCmd = findParentCommand(lineLastNode)!;
      const aliasSignature = this.completionMap.allOfKinds('alias').find(a => a.label === currentCmd.text);
      if (aliasSignature) return getAliasedCompletionItemSignature(aliasSignature);

      const varNode = getChildNodes(lineRootNode).find(c => isVariableDefinition(c));
      const lastCmd = getChildNodes(lineRootNode).filter(c => isCommand(c)).pop();
      logger.log({ line, lastCmds: lastCmd?.text });
      if (varNode && (line.startsWith('set') || line.startsWith('read')) && lastCmd?.text === lineRootNode.text.trim()) {
        const varName = varNode.text;
        const varDocs = PrebuiltDocumentationMap.getByName(varNode.text);
        if (!varDocs.length) return null;
        return {
          signatures: [
            {
              label: varName,
              documentation: {
                kind: 'markdown',
                value: varDocs.map(d => d.description).join('\n'),
              },
            },
          ],
          activeSignature: 0,
          activeParameter: 0,
        };
      }
      if (isRegexStringSignature(line)) {
        const signature = getDefaultSignatures();
        logger.log('signature', signature);
        const cursorLineOffset = line.length - lineLastNode.endIndex;
        const { activeParameter } = findActiveParameterStringRegex(line, cursorLineOffset);
        signature.activeParameter = activeParameter;
        return signature;
      }
      const functionSignature = getFunctionSignatureHelp(
        analyzer,
        lineLastNode,
        line,
        params.position,
      );
      if (functionSignature) return functionSignature;
    } catch (err) {
      logger.error('onShowSignatureHelp', err);
    }
    return null;
  }

  /**
   * Parse and analyze a document. Adds diagnostics to the document, and finds `source` commands.
   * @param document - The document identifier to analyze
   * @param bypassCache - If true, forces fresh analysis bypassing cache (used when content changes)
   */
  public analyzeDocument(document: TextDocumentIdentifier, bypassCache = false) {
    const { path, doc: foundDoc } = this.getDefaultsForPartialParams({ textDocument: document });

    // remove the global symbols for the document before re-analyzing
    analyzer.removeDocumentSymbols(document.uri);

    // get the analyzedDoc.document for re-indexing the workspace,
    // we will eventually want to store the resulting analyzedDoc.document in `doc` below
    let analyzedDoc: AnalyzedDocument;
    if (!foundDoc) {
      const pathDoc = analyzer.analyzePath(path);
      if (pathDoc) {
        analyzedDoc = pathDoc;
      } else {
        logger.log('analyzeDocument: document not found', { path });
        return;
      }
    } else {
      if (bypassCache) {
        // Force fresh analysis by always calling analyzer.analyze, bypassing cache
        analyzedDoc = analyzer.analyze(foundDoc);
      } else {
        // Use cache if available
        const cachedDoc = analyzer.cache.getDocument(foundDoc.uri);
        if (cachedDoc) {
          cachedDoc.ensureParsed();
          analyzedDoc = cachedDoc;
        } else {
          analyzedDoc = analyzer.analyze(foundDoc);
        }
      }
    }

    const doc = analyzedDoc.document;

    // re-indexes the workspace and changes the current workspace to the document
    workspaceManager.handleUpdateDocument(doc);

    return {
      uri: document.uri,
      path: path,
      doc: doc,
    };
  }

  /**
   * Getter for information about the server.
   *
   * Mostly from the `../package.json` file of this module, but also includes
   * other useful entries about the server such as `out/build-time.json` object,
   * `manPath` and certain url entries that are slightly modified for easier
   * access to their links.
   */
  public get info() {
    return PkgJson;
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
    logger.log({ handler: methodName, params });
  }

  // helper to get all the default objects needed when a TextDocumentPositionParam is passed
  // into a handler
  private getDefaults(params: TextDocumentPositionParams): {
    doc?: LspDocument;
    path?: string;
    root?: SyntaxNode | null;
    current?: SyntaxNode | null;
  } {
    const path = uriToPath(params.textDocument.uri);
    const doc = documents.get(path);

    if (!doc || !path) return { path };
    const root = analyzer.getRootNode(doc.uri);
    const current = analyzer.nodeAtPoint(
      doc.uri,
      params.position.line,
      params.position.character,
    );
    return { doc, path, root, current };
  }

  private getDefaultsForPartialParams(params: {
    textDocument: TextDocumentIdentifier;
  }): {
    doc?: LspDocument;
    path: string;
    root?: SyntaxNode | null;
  } {
    const path = uriToPath(params.textDocument.uri);
    const doc = documents.get(path);
    const root = doc ? analyzer.getRootNode(doc.uri) : undefined;
    return { doc, path, root };
  }
}

