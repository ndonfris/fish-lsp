import Parser, { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from './parser';
import { Analyzer } from './analyze';
import { InitializeParams, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, CodeActionParams, CodeAction, DocumentRangeFormattingParams, FoldingRangeParams, FoldingRange, InlayHintParams, MarkupKind, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, CompletionTriggerKind, SignatureHelpParams, SignatureHelp, DocumentHighlight, DocumentHighlightParams, PublishDiagnosticsParams, DidChangeWorkspaceFoldersParams, ShowDocumentParams, ShowDocumentResult } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { LspDocument, LspDocuments } from './document';
import { formatDocumentContent } from './formatting';
import { Logger, logger } from './logger';
import { pathToUri, symbolKindsFromNode, uriToPath } from './utils/translation';
import { getChildNodes, getNodeAtPosition } from './utils/tree-sitter';
import { getVariableExpansionDocs, handleHover } from './hover';
import { getDiagnostics } from './diagnostics/validate';
import { DocumentationCache, initializeDocumentationCache } from './utils/documentation-cache';
import { currentWorkspace, initializeDefaultFishWorkspaces } from './utils/workspace';
import { filterLastPerScopeSymbol, FishDocumentSymbol } from './document-symbol';
import { getRenameWorkspaceEdit, getReferenceLocations } from './workspace-symbol';
import { CompletionPager, initializeCompletionPager, SetupData } from './utils/completion/pager';
import { FishCompletionItem } from './utils/completion/types';
import { getDocumentationResolver } from './utils/completion/documentation';
import { FishCompletionList } from './utils/completion/list';
import { PrebuiltDocumentationMap, getPrebuiltDocUrl } from './utils/snippets';
import { findParentCommand, isCommand, isReturnStatusNumber, isVariableDefinition } from './utils/node-types';
import { adjustInitializeResultCapabilitiesFromConfig, configHandlers, config } from './config';
import { enrichToMarkdown } from './documentation';
import { getAliasedCompletionItemSignature } from './signature';
import { CompletionItemMap } from './utils/completion/startup-cache';
import { getDocumentHighlights } from './document-highlight';
import { buildCommentCompletions } from './utils/completion/comment-completions';
import { createCodeActionHandler } from './code-actions/code-action-handler';
import { createExecuteCommandHandler } from './command';
import { getAllInlayHints } from './code-lens';
import { setupProcessEnvExecFile } from './utils/process-env';
import { SyncFileHelper } from './utils/file-operations';

// @TODO
export type SupportedFeatures = {
  codeActionDisabledSupport: boolean;
};

export const documents = new LspDocuments();

export default class FishServer {
  public static async create(
    connection: Connection,
    params: InitializeParams,
  ): Promise<FishServer> {
    const initUri = params.rootUri || params.rootPath || params.workspaceFolders?.at(0)?.uri;
    logger.log({ initUri, rootUri: params.rootUri, rootPath: params.rootPath, workspaceFolders: params.workspaceFolders });
    // Run these operations in parallel rather than sequentially
    const [
      parser,
      cache,
      _workspaces,
      completionsMap,
      _setupProcessEnvExecFile,
    ] = await Promise.all([
      initializeParser(),
      initializeDocumentationCache(),
      initializeDefaultFishWorkspaces(initUri || ''),
      CompletionItemMap.initialize(),
      setupProcessEnvExecFile(),
    ]);

    const analyzer = new Analyzer(parser);
    const completions = await initializeCompletionPager(logger, completionsMap);

    return new FishServer(
      connection,
      parser,
      analyzer,
      documents,
      completions,
      completionsMap,
      cache,
      logger,
    );
  }

  private initializeParams: InitializeParams | undefined;
  protected features: SupportedFeatures;
  public clientSupportsShowDocument: boolean;

  constructor(
    // the connection of the FishServer
    private connection: Connection,
    private parser: Parser,
    public analyzer: Analyzer,
    private docs: LspDocuments,
    private completion: CompletionPager,
    private completionMap: CompletionItemMap,
    private documentationCache: DocumentationCache,
    protected logger: Logger,
  ) {
    this.features = { codeActionDisabledSupport: true };
    this.clientSupportsShowDocument = false;
  }

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    logger.logAsJson('async server.initialize(params)');
    // logger.log({workspaceFolder: __dirname, rootPath: params.rootPath, workspaceFolders: params.workspaceFolders});
    if (params) {
      logger.log();
      logger.log({ 'server.initialize.params': params });
      logger.log();
    }
    const result = adjustInitializeResultCapabilitiesFromConfig(configHandlers, config);
    logger.log({ onInitializedResult: result });
    // check for conf.d, functions, completions at the end of params.workspaceFolders[0].uri

    this.clientSupportsShowDocument =
      !!params.capabilities.window?.showDocument;
    return result;
  }

  register(connection: Connection): void {
    const codeActionHandler = createCodeActionHandler(this.docs, this.analyzer);
    // const onWorkspaceChangeHandler = onDidChangeWorkspaceFolders(connection, this);
    const executeHandler = createExecuteCommandHandler(this.connection, this.docs, this.logger);
    //this.connection.window.createWorkDoneProgress();
    connection.onInitialized(this.onInitialized.bind(this));
    connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this));
    connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this));
    // connection.sendDiagnostics(this.sendDiagnostics.bind(this));
    // • for multiple completionProviders -> https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts#L15
    // • https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
    connection.onCompletion(this.onCompletion.bind(this));
    connection.onCompletionResolve(this.onCompletionResolve.bind(this)),
    connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
    connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));
    // this.connection.onWorkspaceSymbolResolve(this.onWorkspaceSymbolResolve.bind(this))
    connection.onDefinition(this.onDefinition.bind(this));
    connection.onReferences(this.onReferences.bind(this));
    connection.onHover(this.onHover.bind(this));
    // connection.languages.inlineValue({})
    connection.onRenameRequest(this.onRename.bind(this));
    connection.onDocumentFormatting(this.onDocumentFormatting.bind(this));
    connection.onDocumentRangeFormatting(this.onDocumentRangeFormatting.bind(this));
    connection.onCodeAction(codeActionHandler);
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));
    //this.connection.workspace.applyEdit()
    connection.onDocumentHighlight(this.onDocumentHighlight.bind(this));
    connection.languages.inlayHint.on(this.onInlayHints.bind(this));
    connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));
    connection.onExecuteCommand(executeHandler);
    connection.window.showDocument = this.showDocument.bind(this);

    logger.log({ 'server.register': 'registered' });
  }

  didOpenTextDocument(params: DidOpenTextDocumentParams): void {
    const textDoc = params.textDocument;
    const textDocText = textDoc.text.length > 300
      ? textDoc.text.slice(0, 300) + `\n...[${textDoc.text.length - 300} chars]`
      : textDoc.text;

    this.logParams('didOpenTextDocument', {
      textDocument: {
        version: textDoc.version,
        uri: textDoc.uri,
        text: textDocText,
        languageID: textDoc.languageId,
      },
    });
    const uri = uriToPath(params.textDocument.uri);
    if (!uri) {
      logger.logAsJson(`DID NOT OPEN ${uri} \n URI is null or undefined`);
      return;
    }

    if (this.docs.open(uri, params.textDocument)) {
      const doc = this.docs.get(uri);
      if (doc) {
        currentWorkspace.updateCurrent(doc);
        this.logParams('opened document: ', params.textDocument.uri);
        this.analyzer.analyze(doc);
        this.logParams('analyzed document: ', params.textDocument.uri);
        this.connection.sendDiagnostics(this.sendDiagnostics({ uri: doc.uri, diagnostics: [] }));
      }
    } else {
      logger.logAsJson(`Cannot open already opened doc '${params.textDocument.uri}'.`);
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
    this.logParams('didChangeTextDocument', params);

    const uri = uriToPath(params.textDocument.uri);
    const doc = this.docs.get(uri);
    if (!uri || !doc) return;
    currentWorkspace.updateCurrent(doc);

    doc.applyEdits(doc.version + 1, ...params.contentChanges);
    this.analyzer.analyze(doc);
    logger.logAsJson(`CHANGED -> ${doc.version}:::${doc.uri}`);

    // code-lens
    // invalidateInlayHintsCache(doc.uri);

    const root = this.analyzer.getRootNode(doc);
    if (!root) return;

    this.connection.sendDiagnostics(this.sendDiagnostics({ uri: doc.uri, diagnostics: [] }));
    // else ?
  }

  didCloseTextDocument(params: DidCloseTextDocumentParams): void {
    this.logParams('didCloseTextDocument', params);
    const uri = uriToPath(params.textDocument.uri);
    if (!uri) return;
    logger.logAsJson(`[${this.didCloseTextDocument.name}]: ${params.textDocument.uri}`);
    this.docs.close(uri);
    logger.logAsJson(`closed uri: ${uri}`);
  }

  didSaveTextDocument(params: DidSaveTextDocumentParams): void {
    this.logParams('didSaveTextDocument', params);
    return;
  }

  private async showDocument(params: ShowDocumentParams): Promise<ShowDocumentResult> {
    const { uri, takeFocus } = params;
    this.logParams('showDocument', params);
    const path = pathToUri(uri);
    const content = SyncFileHelper.read(path, 'utf8');
    const doc = LspDocument.create(uri, content);
    documents.open(path, doc.asTextDocumentItem());
    currentWorkspace.updateCurrent(doc);
    const promise = await this.openFileInClient(uri, takeFocus);
    return Promise.resolve({ success: promise });
  }

  async openFileInClient(uri: string, takeFocus: boolean = true) {
    if (!this.clientSupportsShowDocument) {
      logger.log('Client does not support showing documents');
      this.connection.window.showWarningMessage(`Cannot open file: ${uri} (client doesn't support this feature)`);
      return false;
    }

    try {
      const result = await this.connection.sendRequest<LSP.ShowDocumentResult>('window/showDocument', {
        uri,
        takeFocus,
      });
      return result.success;
    } catch (error) {
      logger.log(`Error opening file: ${error}`);
      return false;
    }
  }

  didChangeWorkspace(e: DidChangeWorkspaceFoldersParams) {
    this.logParams('didChangeWorkspaceFolders', e);
    e.event.added.forEach(async folder => {
      if (currentWorkspace.workspaceExists(folder.uri)) {
        logger.log('current workspace already exists');
        return;
      }
      currentWorkspace.updateCurrentWorkspace(folder.uri);
    });
    e.event.removed.forEach(async folder => {
      if (currentWorkspace.workspaceExists(folder.uri)) {
        logger.log('current workspace already exists');
        return;
      }
      currentWorkspace.removeWorkspace(folder.uri);
    });
    return {
      event: this.startBackgroundAnalysis(),
    };
  }

  // @see:
  //  • @link [bash-lsp](https://github.com/bash-lsp/bash-language-server/blob/3a319865af9bd525d8e08cd0dd94504d5b5b7d66/server/src/server.ts#L236)
  async onInitialized() {
    return {
      backgroundAnalysisCompleted: this.startBackgroundAnalysis(),
    };
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

    const { doc, uri, current } = this.getDefaults(params);
    let list: FishCompletionList = FishCompletionList.empty();

    if (!uri || !doc) {
      logger.logAsJson('onComplete got [NOT FOUND]: ' + uri);
      return this.completion.empty();
    }
    const symbols = this.analyzer.allSymbolsAccessibleAtPosition(doc, params.position);
    const { line, word } = this.analyzer.parseCurrentLine(doc, params.position);

    // const items = await shellComplete(line.toString());
    // logger.log({
    //   location: 'server.onComplete',
    //   items: items.slice(0, 5),
    // });

    if (!line) return await this.completion.completeEmpty(symbols);

    const fishCompletionData = {
      uri: doc.uri,
      position: params.position,
      context: {
        triggerKind: params.context?.triggerKind || CompletionTriggerKind.Invoked,
        triggerCharacter: params.context?.triggerCharacter,
      },
    } as SetupData;

    if (line.trim().startsWith('#') && current) {
      logger.log('completeComment');
      return buildCommentCompletions(line, params.position, current, fishCompletionData, word);
    }

    if (word.trim().endsWith('$') || line.trim().endsWith('$') || word.trim() === '$') {
      logger.log('completeVariables');
      return this.completion.completeVariables(line, word, fishCompletionData, symbols);
    }

    try {
      logger.log('complete');
      list = await this.completion.complete(line, fishCompletionData, symbols);
    } catch (error) {
      this.logger.logAsJson('ERROR: onComplete ' + error?.toString() || 'error');
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
  async onDocumentSymbols(
    params: DocumentSymbolParams,
  ): Promise<DocumentSymbol[]> {
    this.logParams('onDocumentSymbols', params);

    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const symbols = this.analyzer.cache.getDocumentSymbols(doc.uri);
    // const globals = symbols.filter(s => s.kind === SymbolKind.Function && s.scope.scopeTag === 'global');
    // const toSearchUris: string[] = [];
    // for (const sym of globals) {
    //   logger.log({ globalSym: sym });
    //   toSearchUris.push(...this.analyzer.getMissingAutoloadedFiles(sym.uri, sym.name));
    // }
    // for (const uri of toSearchUris) {
    //   const file = this.docs.get(uri);
    //   logger.log({ onDocumentSymbols: `file to analyze ${file}` });
    //   if (file) {
    //     this.analyzer.analyze(file);
    //   } else {
    //     logger.log({ onDocumentSymbols: `file not found ${uri}` });
    //     const toAnalyzeDoc = await this.docs.getDocument(uri);
    //     logger.log({ onDocumentSymbols: `file to analyze ${toAnalyzeDoc?.uri}` });
    //     if (!toAnalyzeDoc) continue;
    //     this.analyzer.analyze(toAnalyzeDoc);
    //   }
    // }
    //
    return filterLastPerScopeSymbol(symbols);
  }

  protected get supportHierarchicalDocumentSymbol(): boolean {
    const textDocument = this.initializeParams?.capabilities.textDocument;
    const documentSymbol = textDocument && textDocument.documentSymbol;
    return (
      !!documentSymbol &&
      !!documentSymbol.hierarchicalDocumentSymbolSupport
    );
  }

  /**
   * highlight provider
   */
  onDocumentHighlight(params: DocumentHighlightParams): DocumentHighlight[] {
    this.logParams('onDocumentHighlight', params);
    const { doc } = this.getDefaults(params);
    if (!doc) return [];

    const text = doc.getText();
    const tree = this.parser.parse(text);
    const node = getNodeAtPosition(tree, params.position);
    if (!node) return [];

    const highlights = getDocumentHighlights(tree, node);

    return highlights;
  }

  async onWorkspaceSymbol(params: WorkspaceSymbolParams): Promise<WorkspaceSymbol[]> {
    this.logParams('onWorkspaceSymbol', params.query);

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

    const { doc, uri, root, current } = this.getDefaults(params);
    if (!doc || !uri || !root || !current) return [];

    return getReferenceLocations(this.analyzer, doc, params.position);
  }

  // Probably should move away from `documentationCache`. It works but is too expensive memory wise.
  // REFACTOR into a procedure that conditionally determines output type needed.
  // Also plan to get rid of any other cache's, so that the garbage collector can do its job.
  async onHover(params: HoverParams): Promise<Hover | null> {
    this.logParams('onHover', params);
    const { doc, uri, root, current } = this.getDefaults(params);
    if (!doc || !uri || !root || !current) {
      return null;
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
    const symbolType = [
      'function',
      'class',
      'variable',
    ].includes(kindString) ? kindType : undefined;

    const globalItem = await this.documentationCache.resolve(
      current.text.trim(),
      uri,
      symbolType,
    );

    logger.log({ './src/server.ts:395': `this.documentationCache.resolve() found ${!!globalItem}`, docs: globalItem.docs });
    if (globalItem && globalItem.docs) {
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

  async onRename(params: RenameParams): Promise<WorkspaceEdit | null> {
    this.logParams('onRename', params);

    const { doc } = this.getDefaults(params);
    if (!doc) return null;

    return getRenameWorkspaceEdit(
      this.analyzer,
      doc,
      params.position,
      params.newName,
    );
  }

  async onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentFormatting', params);

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

  async onDocumentRangeFormatting(params: DocumentRangeFormattingParams): Promise<TextEdit[]> {
    this.logParams('onDocumentRangeFormatting', params);
    const { doc } = this.getDefaultsForPartialParams(params);
    if (!doc) return [];

    const range = params.range;
    const startOffset = doc.offsetAt(range.start);
    const endOffset = doc.offsetAt(range.end);

    const originalText = doc.getText().slice(startOffset, endOffset);

    const formattedText = await formatDocumentContent(originalText).catch(error => {
      this.connection.console.error(`Formatting error: ${error}`);
      if (config.fish_lsp_show_client_popups) {
        this.connection.window.showErrorMessage(`Failed to format range: ${error}`);
      }
      return originalText; // fallback to original text on error
    });

    return [TextEdit.replace(range, formattedText)];
  }

  async onFoldingRanges(params: FoldingRangeParams): Promise<FoldingRange[] | undefined> {
    this.logParams('onFoldingRanges', params);

    const file = uriToPath(params.textDocument.uri);
    const document = this.docs.get(file);

    if (!document) {
      throw new Error(`The document should not be opened in the folding range, file: ${file}`);
    }

    //this.analyzer.analyze(document)
    const symbols = this.analyzer.getDocumentSymbols(document.uri);
    const flatSymbols = FishDocumentSymbol.toTree(symbols).toFlatArray();
    logger.logPropertiesForEachObject(
      flatSymbols.filter((s) => s.kind === SymbolKind.Function),
      'name',
      'range',
    );

    const folds = flatSymbols
      .filter((symbol) => symbol.kind === SymbolKind.Function)
      .map((symbol) => FishDocumentSymbol.toFoldingRange(symbol));

    folds.forEach((fold) => logger.log({ fold }));

    return folds;
  }

  async onCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
    this.logParams('onCodeAction', params);

    const uri = uriToPath(params.textDocument.uri);
    const document = this.docs.get(uri);

    if (!document || !uri) return [];

    const results: CodeAction[] = [];

    // for (const diagnostic of params.context.diagnostics) {
    //   const res = handleConversionToCodeAction(
    //     diagnostic,
    //     root,
    //     document,
    //   );
    //   if (res) results.push(res);
    // }

    return results;
  }

  // public async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
  //   this.logParams('onCodeLens', params);
  //   const uri = uriToPath(params.textDocument.uri);
  //   const document = this.docs.get(uri);
  //
  //   if (!document) return [];
  //
  //   return getGlobalReferencesCodeLens(this.analyzer, document);
  // }

  // works but is super slow and resource intensive, plus it doesn't really display much
  async onInlayHints(params: InlayHintParams) {
    logger.log({ params });

    const uri = uriToPath(params.textDocument.uri);
    const document = this.docs.get(uri);
    if (!document) return [];

    // const root = this.analyzer.getRootNode(document);
    // if (!root) return [];

    return getAllInlayHints(this.analyzer, document);
  }

  public onShowSignatureHelp(params: SignatureHelpParams): SignatureHelp | null {
    this.logParams('onShowSignatureHelp', params);

    const { doc, uri } = this.getDefaults(params);
    if (!doc || !uri) return null;

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
    return null;
  }

  public sendDiagnostics(params: PublishDiagnosticsParams) {
    this.logParams('sendDiagnostics', params);

    const { diagnostics } = params;
    const uri = uriToPath(params.uri);
    const doc = this.docs.get(uri);
    if (!doc) return { uri: params.uri, diagnostics };

    const { rootNode } = this.parser.parse(doc.getText());
    // const t = getDiagnostics(rootNode, doc)
    // logger.log({
    //   diagnostics: t.map(d => d.code),
    // })

    // this.connection.sendDiagnostics({ uri: doc.uri, diagnostics: [
    //   ...diagnostics,
    //   ...getDiagnostics(rootNode, doc),
    // ]});
    // const defaultDiagnostics = getDiagnostics(rootNode, doc);
    // const noExecuteDiagnostics = execFishNoExecute(doc.getFilePath()!);
    // const noExecuteDiagnostics = runNoExecuteDiagnostic(doc);
    // const allDiagnostics = [...defaultDiagnostics, ...noExecuteDiagnostics];
    // logger.log({ allDiagnostics: allDiagnostics.map(d => d.code + ':' + d.message + ':' + d.source) });
    return { uri: params.uri, diagnostics: getDiagnostics(rootNode, doc) };
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
    uri?: string;
    root?: SyntaxNode | null;
    current?: SyntaxNode | null;
  } {
    const uri = uriToPath(params.textDocument.uri);
    const doc = this.docs.get(uri);
    if (!doc || !uri) return {};
    const root = this.analyzer.getRootNode(doc);
    const current = this.analyzer.nodeAtPoint(
      doc.uri,
      params.position.line,
      params.position.character,
    );
    return { doc, uri, root, current };
  }

  private getDefaultsForPartialParams(params: {
    textDocument: TextDocumentIdentifier;
  }): {
    doc?: LspDocument;
    uri?: string;
    root?: SyntaxNode | null;
  } {
    const uri = uriToPath(params.textDocument.uri);
    const doc = this.docs.get(uri);
    const root = doc ? this.analyzer.getRootNode(doc) : undefined;
    return { doc, uri, root };
  }

  public async startBackgroundAnalysis(): Promise<{ filesParsed: number; }> {
    // ../node_modules/vscode-languageserver/lib/common/progress.d.ts
    const notifyCallback = (text: string) => {
      if (!config.fish_lsp_show_client_popups) return;
      this.connection.window.showInformationMessage(text);
    };
    return this.analyzer.initiateBackgroundAnalysis(notifyCallback);
  }
}

/**
 * ERROR:
 * /home/user/repos/fish-lsp.git/feat.seperating-workspaces-and-other-env-stuff/node_modules/vscode-languageserver/lib/common/workspaceFolder.js:35
 *              throw new Error('Client doesn\'t support sending workspace folder change events.');
 */
export function onDidChangeWorkspaceFolders(_connection: Connection, server: FishServer) {
  return async function(event: LSP.WorkspaceFoldersChangeEvent) {
    // Handle added workspaces
    logger.log('didChangeWorkspaceFolders', event);
    event.added.forEach(async folder => {
      if (currentWorkspace.workspaceExists(folder.uri)) {
        logger.log('current workspace already exists');
        return;
      }
      currentWorkspace.updateCurrentWorkspace(folder.uri);
    });
    event.removed.forEach(async folder => {
      if (currentWorkspace.workspaceExists(folder.uri)) {
        logger.log('current workspace already exists');
        return;
      }
      currentWorkspace.removeWorkspace(folder.uri);
    });

    // Re-index workspaces
    await server.startBackgroundAnalysis();
  };
}
