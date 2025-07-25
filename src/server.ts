import { SyntaxNode } from 'web-tree-sitter';
import { AnalyzedDocument, analyzer, Analyzer } from './analyze';
import { InitializeParams, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, DocumentRangeFormattingParams, FoldingRangeParams, FoldingRange, InlayHintParams, MarkupKind, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, CompletionTriggerKind, SignatureHelpParams, SignatureHelp, ImplementationParams, CodeLensParams, CodeLens, WorkspaceFoldersChangeEvent } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { LspDocument, documents } from './document';
import { formatDocumentContent } from './formatting';
import { logger } from './logger';
import { connection, setExternalConnection } from './utils/startup';
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
import { findParentCommand, isAliasDefinitionName, isCommand, isOption, isReturnStatusNumber, isVariableDefinition } from './utils/node-types';
import { config, Config } from './config';
import { enrichToMarkdown, handleSourceArgumentHover } from './documentation';
import { findActiveParameterStringRegex, getAliasedCompletionItemSignature, getDefaultSignatures, getFunctionSignatureHelp, isRegexStringSignature } from './signature';
import { CompletionItemMap } from './utils/completion/startup-cache';
import { getDocumentHighlights } from './document-highlight';
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

export default class FishServer {
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
      capabilities.workspace && !!capabilities.workspace.workspaceFolders
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

  register(connection: Connection): void {
    // setup handlers
    const { onCodeAction } = codeActionHandlers(documents, analyzer);
    const documentHighlightHandler = getDocumentHighlights(analyzer);
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
    // connection.onCodeLensResolve(this.onCodeLensResolve.bind(this));
    // connection.onCodeActionResolve(onCodeActionResolve);
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));

    connection.onDocumentHighlight(documentHighlightHandler);
    connection.languages.inlayHint.on(this.onInlayHints.bind(this));
    connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));
    connection.onExecuteCommand(commandCallback);

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
    currentDocument = doc;
    doc = doc.update(params.contentChanges);
    documents.set(doc);
    this.analyzeDocument({ uri: doc.uri });
    if (!this.backgroundAnalysisComplete) {
      await workspaceManager.analyzePendingDocuments(progress);
      progress.done();
      return;
    }
    await workspaceManager.analyzePendingDocuments();
    progress.done();
  }

  didCloseTextDocument(params: LSP.DidCloseTextDocumentParams): void {
    this.logParams('didCloseTextDocument', params);
    workspaceManager.handleCloseDocument(params.textDocument.uri);
  }

  async didSaveTextDocument(params: LSP.DidSaveTextDocumentParams): Promise<void> {
    this.logParams('didSaveTextDocument', params);
    const path = uriToPath(params.textDocument.uri);
    const doc = documents.get(path);
    if (doc) {
      this.analyzeDocument({ uri: doc.uri });
      workspaceManager.handleOpenDocument(doc);
      workspaceManager.handleUpdateDocument(doc);
      await workspaceManager.analyzePendingDocuments();
    }
  }

  /**
   * Stop the server and close all workspaces.
   */
  async onShutdown() {
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
    const symbols = analyzer.cache.getDocumentSymbols(doc.uri);
    return filterLastPerScopeSymbol(symbols).map(s => s.toDocumentSymbol()).filter(s => !!s);
  }

  protected get supportHierarchicalDocumentSymbol(): boolean {
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
      const doc = documents.get(uri);
      if (doc) {
        const docSymbols = analyzer.getFlatDocumentSymbols(doc.uri);
        symbols.push(...filterLastPerScopeSymbol(docSymbols));
      }
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
      // workspaceManager.current?.setAllPending();
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
      result = handleSourceArgumentHover(analyzer, current);
      if (result) return result;
    }

    if (current.parent && isSourceCommandArgumentName(current.parent)) {
      result = handleSourceArgumentHover(analyzer, current.parent);
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

    const formattedText = await formatDocumentContent(doc.getText()).catch(error => {
      // this.connection.console.error(`Formatting error: ${error}`);
      if (config.fish_lsp_show_client_popups) {
        connection.window.showErrorMessage(`Failed to format range: ${error}`);
      }
      return doc.getText(); // fallback to original text on error
    });

    const fullRange: LSP.Range = {
      start: doc.positionAt(0),
      end: doc.positionAt(doc.getText().length),
    };

    return [TextEdit.replace(fullRange, formattedText)];
  }

  async onDocumentTypeFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentTypeFormatting', params);
    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const formattedText = await formatDocumentContent(doc.getText()).catch(error => {
      connection.console.error(`Formatting error: ${error}`);
      if (config.fish_lsp_show_client_popups) {
        connection.window.showErrorMessage(`Failed to format range: ${error}`);
      }
      return doc.getText(); // fallback to original text on error
    });

    const fullRange: LSP.Range = {
      start: doc.positionAt(0),
      end: doc.positionAt(doc.getText().length),
    };

    return [TextEdit.replace(fullRange, formattedText)];
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
    return null;
  }

  public clearDiagnostics(document: TextDocumentIdentifier) {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }

  /**
   * Parse and analyze a document. Adds diagnostics to the document, and finds `source` commands
   */
  public analyzeDocument(document: TextDocumentIdentifier) {
    const { path, doc: foundDoc } = this.getDefaultsForPartialParams({ textDocument: document });
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
      analyzedDoc = analyzer.analyze(foundDoc);
    }
    const doc = analyzedDoc.document;
    const diagnostics = analyzer.getDiagnostics(doc.uri);
    logger.log('Sending Diagnostics', {
      uri: doc.uri,
      diagnostics: diagnostics.map(d => d.code),
    });
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
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
   * Includes the package.json information, and other useful data about the server.
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

