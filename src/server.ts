import { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from './parser';
import { Analyzer } from './analyze';
import { AnalyzeProgressToken, ProgressWrapper } from './utils/progress-token';
import { InitializeParams, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, DocumentRangeFormattingParams, FoldingRangeParams, FoldingRange, InlayHintParams, MarkupKind, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, CompletionTriggerKind, SignatureHelpParams, SignatureHelp, ImplementationParams, CodeLensParams, CodeLens, WorkspaceFoldersChangeEvent } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { LspDocument, LspDocuments, documents } from './document';
import { formatDocumentContent } from './formatting';
import { Logger, logger } from './logger';
import { formatTextWithIndents, symbolKindsFromNode, uriToPath } from './utils/translation';
import { getChildNodes } from './utils/tree-sitter';
import { getVariableExpansionDocs, handleHover } from './hover';
import { DocumentationCache, initializeDocumentationCache } from './utils/documentation-cache';
import { findCurrentWorkspace, getWorkspacePathsFromInitializationParams, initializeDefaultFishWorkspaces } from './utils/workspace';
import { workspaces } from './utils/workspace-manager';
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
export let currentDocument: LspDocument | null = null;

export default class FishServer {
  public static async create(
    connection: Connection,
    params: InitializeParams,
  ): Promise<{ server: FishServer; initializeResult: InitializeResult; }> {
    await setupProcessEnvExecFile();
    const capabilities = params.capabilities;
    const initializeResult = Config.initialize(params, connection);
    logger.log({
      server: 'FishServer',
      // initializeResult,
      rootUri: params.rootUri,
      rootPath: params.rootPath,
      workspaceFolders: params.workspaceFolders,
    });
    hasWorkspaceFolderCapability = !!(
      capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    const initializeUris = getWorkspacePathsFromInitializationParams(params);
    logger.info('initializeUris', initializeUris);

    // Run these operations in parallel rather than sequentially
    const [
      parser,
      cache,
      _workspaces,
      completionsMap,
    ] = await Promise.all([
      initializeParser(),
      initializeDocumentationCache(),
      initializeDefaultFishWorkspaces(...initializeUris),
      CompletionItemMap.initialize(),
    ]);

    const analyzer = new Analyzer(parser);
    const completions = await initializeCompletionPager(logger, completionsMap);

    const server = new FishServer(
      connection,
      // parser,
      analyzer,
      documents,
      completions,
      completionsMap,
      cache,
      logger,
    );
    if (!hasWorkspaceFolderCapability) {
      initializeResult.capabilities.workspace = {
        workspaceFolders: {
          supported: false,
          changeNotifications: false,
        },
      };
    }
    if (hasWorkspaceFolderCapability) {
      initializeResult.capabilities.workspace = {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      };
    }
    server.register(connection);
    return { server, initializeResult };
  }

  private initializeParams: InitializeParams | undefined;
  protected features: SupportedFeatures;
  public clientSupportsShowDocument: boolean;
  public backgroundAnalysisComplete: boolean;

  constructor(
    // the connection of the FishServer
    private connection: Connection,
    public analyzer: Analyzer,
    private docs: LspDocuments,
    private completion: CompletionPager,
    private completionMap: CompletionItemMap,
    private documentationCache: DocumentationCache,
    protected logger: Logger,
  ) {
    this.features = { codeActionDisabledSupport: true };
    this.clientSupportsShowDocument = false;
    this.backgroundAnalysisComplete = false;
  }

  register(connection: Connection): void {
    // setup handlers
    const { onCodeAction } = codeActionHandlers(this.docs, this.analyzer);
    const executeHandler = createExecuteCommandHandler(this.connection, this.docs, this.analyzer);
    const documentHighlightHandler = getDocumentHighlights(this.analyzer);

    // register the handlers
    connection.onInitialized(this.onInitialized.bind(this));
    connection.onShutdown(this.onShutdown.bind(this));
    connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this));
    connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this));

    connection.onCompletion(this.onCompletion.bind(this));
    connection.onCompletionResolve(this.onCompletionResolve.bind(this));

    connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
    connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));

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
    connection.onExecuteCommand(executeHandler);
    logger.log({ 'server.register': 'registered' });
  }

  async didOpenTextDocument(params: LSP.DidOpenTextDocumentParams): Promise<void> {
    this.logParams('didOpenTextDocument', params);
    logger.info('didOpenTextDocument', params.textDocument.uri);
    const path = uriToPath(params.textDocument.uri);
    const doc = this.docs.openPath(path, params.textDocument);
    currentDocument = doc;
    this.analyzeDocument({ uri: doc.uri });
    if (workspaces.current) {
      // workspaces.current.add(...this.analyzer.collectAllSources(doc.uri));
      const progress = await AnalyzeProgressToken.create(this.connection, { workspace: workspaces.current });
      this.analyzer.analyzeWorkspace(workspaces.current, (t) => logger.log(t), progress);
    }
  }

  async didChangeTextDocument(params: LSP.DidChangeTextDocumentParams): Promise<void> {
    this.logParams('didChangeTextDocument', params);
    const path = uriToPath(params.textDocument.uri);
    let doc = this.docs.get(path);
    if (!doc) {
      doc = this.analyzer.analyzePath(path).document;
    }
    if (!doc) {
      logger.error('didChangeTextDocument: document not found', { path });
      return;
    }
    currentDocument = doc;
    doc = doc.update(params.contentChanges);
    this.docs.set(doc);
    this.analyzeDocument({ uri: doc.uri });
    workspaces.updateCurrentFromUri(doc.uri);
    logger.log({
      didChangeTextDocument: params.textDocument.uri,
      'Workspaces.current.name: ': workspaces.current?.name,
      willRunBackgroundAnalysis: workspaces.current?.isAnalyzed(),
      uris: workspaces.current?.allUris.size,
    });
    // workspaces.current?.unanalyzeUri(doc.uri);
    this.analyzer.updateConfigInWorkspace(doc.uri);
    if (workspaces.current) {
      // const progress = await AnalyzeProgressToken.create(this.connection, {workspace: workspaces.current});
      this.analyzer.analyzeWorkspace(workspaces.current, (t) => logger.log(t));
    }
  }

  didCloseTextDocument(params: LSP.DidCloseTextDocumentParams): void {
    this.logParams('didCloseTextDocument', params);
    const path = uriToPath(params.textDocument.uri);
    this.docs.close(path);
    const previousWorkspace = workspaces.removeLast();
    this.clearDiagnostics(params.textDocument);
    if (previousWorkspace) {
      const result = this.analyzer.clearDocumentFromWorkspace(previousWorkspace, this.docs, params.textDocument.uri);
      logger.log('didCloseTextDocument', {
        time: new Date().toISOString(),
        uri: params.textDocument.uri,
        removed: {
          uris: result.removedUris.length,
          symbols: result.removedSymbols.length,
        },
        kept: {
          uris: this.analyzer.cache.uris().length,
          symbols: this.analyzer.globalSymbols.allSymbols.length,
        },
        previousWorkspace: {
          name: previousWorkspace.name,
          uris: previousWorkspace.uris.size,
        },
        newWorkspace: {
          name: workspaces.current?.name,
          uris: workspaces.current?.uris.size,
        },
      });
    }
  }

  async didSaveTextDocument(params: LSP.DidSaveTextDocumentParams): Promise<void> {
    this.logParams('didSaveTextDocument', params);
    const newSources = this.analyzer.collectAllSources(params.textDocument.uri);
    const newWorkspace = await findCurrentWorkspace(params.textDocument.uri);
    newSources.forEach(uri => {
      newWorkspace?.addUri(uri);
    });
    logger.info({
      didSaveTextDocument: params.textDocument.uri,
      'Workspaces.current.name: ': workspaces.current?.name,
      willRunBackgroundAnalysis: workspaces.current?.isAnalyzed(),
    });
    if (workspaces.current && !workspaces.current.isAnalyzed()) {
      logger.log('willRunBackgroundAnalysis', {
        workspaces: workspaces.current?.name,
      });
      const progress = await AnalyzeProgressToken.create(this.connection, { workspace: workspaces.current });
      await this.analyzer.analyzeWorkspace(workspaces.current, (t) => logger.log(t), progress);
    }
    this.analyzer.updateConfigInWorkspace(params.textDocument.uri);
  }

  async onInitialized() {
    if (hasWorkspaceFolderCapability) {
      this.connection.workspace.onDidChangeWorkspaceFolders(event => {
        logger.info('onDidChangeWorkspaceFolders', event);
        if (this.backgroundAnalysisComplete) {
          return;
        }
        this.handleWorkspaceFolderChanges(event);
      });
    }
    this.backgroundAnalysisComplete = true;
    const progress = await AnalyzeProgressToken.create(this.connection, { title: '[fish-lsp]', message: 'Analyzing workspace...' });
    this.startBackgroundAnalysis(progress);
  }

  /**
   * Stop the server and close all workspaces.
   */
  async onShutdown() {
    while (workspaces.orderedWorkspaces().length > 0) {
      workspaces.removeLast();
    }
    this.docs.closeAll();
    currentDocument = null;
    this.backgroundAnalysisComplete = false;
  }

  private async handleWorkspaceFolderChanges(event: WorkspaceFoldersChangeEvent) {
    this.logParams('handleWorkspaceFolderChanges', event);
    // Handle added workspaces
    for (const folder of event.added) {
      const workspace = workspaces.findWorkspace(folder.uri);
      if (workspace && !workspace.isAnalyzed()) {
        // Analyze the new workspace
        const progress = await AnalyzeProgressToken.create(this.connection, { workspace: workspace });
        // progress.begin('analyzing workspace', 0, `analyzing ${workspace.name}`);
        await this.analyzer.analyzeWorkspace(workspace, (t) => logger.log(t), progress);
      }
    }

    // Handle removed workspaces
    for (const folder of event.removed) {
      const workspace = workspaces.findWorkspace(folder.uri);
      if (workspace) {
        // Clean up the workspace data
        this.analyzer.clearEntireWorkspace(workspace, this.docs);
      }
    }
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
      return this.completion.empty();
    }

    const { doc, path, current } = this.getDefaults(params);
    let list: FishCompletionList = FishCompletionList.empty();

    if (!path || !doc) {
      logger.logAsJson('onComplete got [NOT FOUND]: ' + path);
      return this.completion.empty();
    }
    const symbols = this.analyzer.allSymbolsAccessibleAtPosition(doc, params.position);
    const { line, word } = this.analyzer.parseCurrentLine(doc, params.position);
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
    const symbols = this.analyzer.cache.getDocumentSymbols(doc.uri);
    return filterLastPerScopeSymbol(symbols).map((symbol) => symbol.toDocumentSymbol());
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
    const workspace = workspaces.current;
    for (const uri of workspace?.allUris || []) {
      const doc = this.docs.get(uri);
      if (doc) {
        const docSymbols = this.analyzer.getFlatDocumentSymbols(doc.uri);
        symbols.push(...filterLastPerScopeSymbol(docSymbols));
      }
    }

    logger.log('symbols', {
      uris: workspace?.allUris,
      symbols: symbols.map(s => s.name),
    });
    return this.analyzer.getWorkspaceSymbols(params.query) || [];
  }

  // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#showDocumentParams
  async onDefinition(params: DefinitionParams): Promise<Location[]> {
    this.logParams('onDefinition', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return [];

    return this.analyzer.getDefinitionLocation(doc, params.position);
  }

  async onReferences(params: ReferenceParams): Promise<Location[]> {
    this.logParams('onReference', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return [];

    return getReferences(this.analyzer, doc, params.position);
  }

  /**
   * bi-directional lookup of completion <-> definition under cursor location.
   */
  async onImplementation(params: ImplementationParams): Promise<Location[]> {
    this.logParams('onImplementation', params);
    const { doc } = this.getDefaults(params);
    if (!doc) return [];
    const symbols = this.analyzer.cache.getDocumentSymbols(doc.uri);
    const lastSymbols = filterLastPerScopeSymbol(symbols);
    logger.log('symbols', formatFishSymbolTree(lastSymbols));
    const result = this.analyzer.getImplementation(doc, params.position);
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
      result = handleSourceArgumentHover(this.analyzer, current);
      if (result) return result;
    }

    if (current.parent && isSourceCommandArgumentName(current.parent)) {
      result = handleSourceArgumentHover(this.analyzer, current.parent);
      if (result) return result;
    }

    if (isAliasDefinitionName(current)) {
      result = this.analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      if (result) return result;
    }

    if (isArgparseVariableDefinitionName(current)) {
      logger.log('isArgparseDefinition');
      result = this.analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      return result;
    }

    if (isOption(current)) {
      // check that we aren't hovering a function option that is defined by
      // argparse inside the function, if we are then return it's hover value
      result = this.analyzer.getDefinition(doc, params.position)?.toHover(doc.uri) || null;
      if (result) return result;
      // otherwise we get the hover using inline documentation from `complete --do-complete {option}`
      result = await handleHover(
        this.analyzer,
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
    const isPrebuiltVariableWithoutDefinition = getVariableExpansionDocs(this.analyzer, doc, params.position);
    const prebuiltHover = isPrebuiltVariableWithoutDefinition(current);
    if (prebuiltHover) return prebuiltHover;

    const symbolItem = this.analyzer.getHover(doc, params.position);
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

    const definition = this.analyzer.getDefinition(doc, params.position);
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
      this.analyzer,
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

    const locations = getRenames(this.analyzer, doc, params.position, params.newName);

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
        this.connection.window.showErrorMessage(`Failed to format range: ${error}`);
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
      this.connection.console.error(`Formatting error: ${error}`);
      if (config.fish_lsp_show_client_popups) {
        this.connection.window.showErrorMessage(`Failed to format range: ${error}`);
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
        this.connection.window.showErrorMessage(`Failed to format range: ${params.textDocument.uri}`);
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
    const symbols = this.analyzer.getDocumentSymbols(doc.uri);
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

    return getAllInlayHints(this.analyzer, doc);
  }

  // https://code.visualstudio.com/api/language-extensions/programmatic-language-features#codelens-show-actionable-context-information-within-source-code
  async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
    this.logParams('onCodeLens', params);

    const path = uriToPath(params.textDocument.uri);
    const doc = this.docs.get(path);

    if (!doc) return [];

    return getReferenceCountCodeLenses(this.analyzer, doc);
    // return getCodeLensInit(this.analyzer, doc);
  }

  public onShowSignatureHelp(params: SignatureHelpParams): SignatureHelp | null {
    this.logParams('onShowSignatureHelp', params);

    const { doc, path } = this.getDefaults(params);
    if (!doc || !path) return null;

    const { line, lineRootNode, lineLastNode } = this.analyzer.parseCurrentLine(doc, params.position);
    if (line.trim() === '') return null;
    const currentCmd = findParentCommand(lineLastNode)!;
    // const commands = getChildNodes(lineRootNode).filter(isCommand)
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
      logger.log({
        line,
        lineLength: line.length,
        lineLastNodeEndIndex: lineLastNode.endIndex,
        lineLastNodeText: lineLastNode.text,
        cursorLineOffset,
        activeParameter,
      });
      logger.log('activeParameter', activeParameter);
      signature.activeParameter = activeParameter;
      return signature;
    }
    const functionSignature = getFunctionSignatureHelp(
      this.analyzer,
      lineLastNode,
      line,
      params.position,
    );
    if (functionSignature) return functionSignature;
    return null;
  }

  public clearDiagnostics(document: TextDocumentIdentifier) {
    this.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }

  /**
   * Parse and analyze a document. Adds diagnostics to the document, and finds `source` commands
   */
  public analyzeDocument(document: TextDocumentIdentifier) {
    const result = this.getDefaultsForPartialParams({ textDocument: document });
    const { path } = result;
    let { doc } = result;
    if (!doc) {
      doc = this.analyzer.analyzePath(path).document;
    } else {
      doc = this.analyzer.analyze(doc).document;
    }
    const resultDoc = this.docs.get(path);
    if (!resultDoc) {
      logger.error(`Document not found: ${path}`);
      this.connection.sendDiagnostics({
        uri: document.uri,
        diagnostics: [],
      });
      logger.log('Sending empty diagnostics', {
        uri: document.uri,
        diagnostics: [],
      });
      return { uri: document.uri, path: path, doc: null };
    }

    const diagnostics = this.analyzer.getDiagnostics(resultDoc.uri);
    logger.log('Sending Diagnostics', {
      uri: resultDoc.uri,
      diagnostics: diagnostics.map(d => d.code),
    });
    this.connection.sendDiagnostics({ uri: resultDoc.uri, diagnostics });
    workspaces.updateCurrentFromUri(resultDoc.uri);
    const newUris = this.analyzer.collectAllSources(resultDoc.uri);
    const current = workspaces.current;
    if (current) {
      newUris.forEach(uri => {
        logger.log('Adding uri to current workspace', { uri });
        current.addUri(uri);
      });
    }

    return {
      uri: document.uri,
      path: path,
      doc: doc,
    };
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
    const doc = this.docs.get(path);

    if (!doc || !path) return { path };
    const root = this.analyzer.getRootNode(doc.uri);
    const current = this.analyzer.nodeAtPoint(
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
    const doc = this.docs.get(path);
    const root = doc ? this.analyzer.getRootNode(doc.uri) : undefined;
    return { doc, path, root };
  }

  public async startBackgroundAnalysis(progress?: ProgressWrapper) {
    const notifyCallback = (text: string) => {
      logger.info(`${new Date().toLocaleTimeString()} - [BACKGROUND ANALYSIS] - ${text}`);
      if (config?.fish_lsp_show_client_popups) {
        this.connection.window.showInformationMessage(text);
      }
    };
    // const progressCallback = AnalyzeProgressToken.callbackfn(this.connection);
    // const progress = await AnalyzeProgressToken.create(this.connection, { title: '[fish-lsp]', message: 'Analyzing workspace...' });
    return this.analyzer.initiateBackgroundAnalysis(this.connection, notifyCallback, progress);
    // return this.analyzer
    //   .initiateBackgroundAnalysis(notifyCallback, progressCallback)
    //   .then((result) => {
    //     this.backgroundAnalysisComplete = true;
    //     ProgressTokens.cancelAll();
    //     return { totalFilesParsed: result.totalFilesParsed };
    //   });
    // return this.analyzer.initiateBackgroundAnalysis(notifyCallback, progressCallback);
    // Return a placeholder promise immediately
    // return new Promise(resolve => {
    //   // Use setTimeout to ensure background processing happens on the next event loop tick
    //   setTimeout(() => {
    //     // Start analysis without awaiting completion
    //     this.analyzer.initiateBackgroundAnalysis(notifyCallback, progressCallback)
    //       .then(result => {
    //         this.backgroundAnalysisComplete = true;
    //         // Notify client that analysis is complete
    //         this.connection.sendNotification('fish-lsp/analysisComplete', result);
    //         resolve(result);
    //       })
    //       .catch(err => {
    //         logger.error(`Background analysis error: ${err}`);
    //         this.backgroundAnalysisComplete = true;
    //         resolve({ totalFilesParsed: 0 });
    //       });
    //   }, 0);
    // });
  }
}

