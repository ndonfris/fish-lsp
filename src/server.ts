import Parser, { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from './parser';
import { Analyzer } from './analyze';
//import {  generateCompletionList, } from "./completion";
import { InitializeParams, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, DocumentSymbolParams, DefinitionParams, Location, ReferenceParams, DocumentSymbol, DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, InitializeResult, HoverParams, Hover, RenameParams, TextDocumentPositionParams, TextDocumentIdentifier, WorkspaceEdit, TextEdit, DocumentFormattingParams, CodeActionParams, CodeAction, DocumentRangeFormattingParams, FoldingRangeParams, FoldingRange, InlayHintParams, MarkupKind, WorkspaceSymbolParams, WorkspaceSymbol, SymbolKind, CompletionTriggerKind, SignatureHelpParams, SignatureHelp, DocumentHighlight, DocumentHighlightParams, ExecuteCommandParams, PublishDiagnosticsParams } from 'vscode-languageserver';
import { ExecResultWrapper, execEntireBuffer, execLineInBuffer, executeThemeDump, useMessageKind } from './executeHandler';
import * as LSP from 'vscode-languageserver';
import { LspDocument, LspDocuments } from './document';
import { formatDocumentContent } from './formatting';
import { Logger, ServerLogsPath } from './logger';
import { symbolKindsFromNode, uriToPath } from './utils/translation';
import { getChildNodes, getNodeAtPosition } from './utils/tree-sitter';
import { handleHover } from './hover';
import { getDiagnostics } from './diagnostics/validate';
/*import * as Locations from './utils/locations';*/
import { FishProtocol } from './utils/fishProtocol';
// import { handleConversionToCodeAction } from './diagnostics/handleConversion';
import { inlayHintsProvider } from './inlay-hints';
import { DocumentationCache, initializeDocumentationCache } from './utils/documentationCache';
import { initializeDefaultFishWorkspaces } from './utils/workspace';
import { filterLastPerScopeSymbol, FishDocumentSymbol } from './document-symbol';
//import { FishCompletionItem, FishCompletionData, FishCompletionItemKind } from './utils/completion-strategy';
//import { getFlagDocumentationAsMarkup } from './utils/flag-documentation';
import { getRenameWorkspaceEdit, getReferenceLocations } from './workspace-symbol';
import { CompletionPager, initializeCompletionPager } from './utils/completion/pager';
import { FishCompletionItem } from './utils/completion/types';
import { getDocumentationResolver } from './utils/completion/documentation';
import { FishCompletionList } from './utils/completion/list';
import { config } from './cli';
import { PrebuiltDocumentationMap, getPrebuiltDocUrl } from './utils/snippets';
import { findParentCommand, isCommand, isVariableDefinition } from './utils/node-types';
import { adjustInitializeResultCapabilitiesFromConfig, configHandlers } from './config';
import { enrichToMarkdown } from './documentation';
import { getAliasedCompletionItemSignature } from './signature';
import { CompletionItemMap } from './utils/completion/startup-cache';
import { getDocumentHighlights } from './document-highlight';
import { SyncFileHelper } from './utils/fileOperations';

// @TODO
export type SupportedFeatures = {
  codeActionDisabledSupport: boolean;
};

export default class FishServer {
  public static async create(
    connection: Connection,
    _params: InitializeParams,
  ): Promise<FishServer> {
    const documents = new LspDocuments();
    const logger = new Logger(config.fish_lsp_logfile || ServerLogsPath, true, connection.console);
    const completionsMap = await CompletionItemMap.initialize();

    return await Promise.all([
      initializeParser(),
      initializeDocumentationCache(),
      initializeDefaultFishWorkspaces(),
      initializeCompletionPager(logger, completionsMap),
    ]).then(([parser, cache, workspaces, completions]) => {
      const analyzer = new Analyzer(parser, workspaces);
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
    });
  }

  private initializeParams: InitializeParams | undefined;
  protected features: SupportedFeatures;

  constructor(
    // the connection of the FishServer
    private connection: Connection,
    private parser: Parser,
    private analyzer: Analyzer,
    private docs: LspDocuments,
    private completion: CompletionPager,
    private completionMap: CompletionItemMap,
    private documentationCache: DocumentationCache,
    protected logger: Logger,
  ) {
    this.features = { codeActionDisabledSupport: false };
  }

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    this.logger.logAsJson(`Initialized server FISH-LSP with ${params.workspaceFolders || ''}`);
    const result = adjustInitializeResultCapabilitiesFromConfig(configHandlers, config);
    this.logger.log({ onInitializedResult: result });
    return result;
  }

  register(connection: Connection): void {
    //this.connection.window.createWorkDoneProgress();
    connection.onInitialized(this.onInitialized.bind(this));
    connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this));
    connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this));
    connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this));
    connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this));
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
    connection.onRenameRequest(this.onRename.bind(this));
    connection.onDocumentFormatting(this.onDocumentFormatting.bind(this));
    connection.onDocumentRangeFormatting(this.onDocumentRangeFormatting.bind(this));
    connection.onCodeAction(this.onCodeAction.bind(this));
    connection.onFoldingRanges(this.onFoldingRanges.bind(this));
    //this.connection.workspace.applyEdit()
    connection.onDocumentHighlight(this.onDocumentHighlight.bind(this));
    connection.languages.inlayHint.on(this.onInlayHints.bind(this));
    connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));
    connection.onExecuteCommand(this.onExecuteCommand.bind(this));
    connection.console.log('FINISHED FishLsp.register()');
  }

  didOpenTextDocument(params: DidOpenTextDocumentParams): void {
    this.logParams('didOpenTextDocument', params);
    const uri = uriToPath(params.textDocument.uri);
    if (!uri) {
      this.logger.logAsJson(`DID NOT OPEN ${uri} \n URI is null or undefined`);
      return;
    }
    if (this.docs.open(uri, params.textDocument)) {
      const doc = this.docs.get(uri);
      if (doc) {
        this.logParams('opened document: ', params.textDocument.uri);
        this.analyzer.analyze(doc);
        this.logParams('analyzed document: ', params.textDocument.uri);
        this.connection.sendDiagnostics(this.sendDiagnostics({ uri: doc.uri, diagnostics: [] }));
      }
    } else {
      // this.logParams('analyzed document: ', params.textDocument.uri);
      this.logger.logAsJson(
        `Cannot open already opened doc '${params.textDocument.uri}'.`,
      );
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

    doc.applyEdits(doc.version + 1, ...params.contentChanges);
    this.analyzer.analyze(doc);
    this.logger.logAsJson(`CHANGED -> ${doc.version}:::${doc.uri}`);
    const root = this.analyzer.getRootNode(doc);
    if (!root) return;
    this.connection.sendDiagnostics(this.sendDiagnostics({ uri: doc.uri, diagnostics: [] }));
    // else ?
  }

  didCloseTextDocument(params: DidCloseTextDocumentParams): void {
    this.logParams('didCloseTextDocument', params);
    const uri = uriToPath(params.textDocument.uri);
    if (!uri) return;
    this.logger.logAsJson(`[${this.didCloseTextDocument.name}]: ${params.textDocument.uri}`);
    this.docs.close(uri);
    this.logger.logAsJson(`closed uri: ${uri}`);
  }

  didSaveTextDocument(params: DidSaveTextDocumentParams): void {
    this.logParams('didSaveTextDocument', params);
    return;
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
    const uri = uriToPath(params.textDocument.uri);
    let list: FishCompletionList = FishCompletionList.empty();
    const doc = this.docs.get(uri);

    if (!uri || !doc) {
      this.logger.logAsJson('onComplete got [NOT FOUND]: ' + uri);
      return this.completion.empty();
    }
    const { line } = this.analyzer.parseCurrentLine(doc, params.position);

    const fishCompletionData = {
      uri: doc.uri,
      position: params.position,
      context: {
        triggerKind: params.context?.triggerKind || CompletionTriggerKind.Invoked,
        triggerCharacter: params.context?.triggerCharacter,
      },
    };

    if (line.trim().startsWith('#')) {
      return FishCompletionList.empty();
    }

    try {
      const symbols = this.analyzer.getFlatDocumentSymbols(uri);
      list = await this.completion.complete(line, fishCompletionData, symbols);
      this.logger.logAsJson(`line: '${line}' got ${list.items.length} items"`);
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

  public async onExecuteCommand(params: ExecuteCommandParams) {
    this.logParams('onExecuteCommand', params);

    /** define inner switch block variables */
    let [name, path, file, line, text] = ['', '', '', '', ''];
    let doc: LspDocument | undefined;
    let output: ExecResultWrapper;

    const commandName = params.command.toString().slice(params.command.toString().indexOf('.') + 1);
    this.logger.logAsJson(commandName);
    switch (commandName) {
      case 'executeLine':
        file = params.arguments![0] as string || '';
        line = params.arguments![1] as string || '';
        // console.log({'last accessed: ': this.docs.files})

        if (!file || !line) {
          this.logger.log({ gotNull: 'gotNull', file, line });
          return null;
        }

        doc = this.docs.get(file);

        if (!doc) {
          this.logger.log({ title: 'docs was null', doc });
          return [];
        }
        text = doc.getLine(Number.parseInt(line) - 1);
        this.logParams('onExecuteCommand', text);
        output = await execLineInBuffer(text);
        useMessageKind(this.connection, output);
        return;
      case 'createTheme':
        if (!params.arguments || !params.arguments[0].toString()) return;

        name = params.arguments[0] as string || '';
        path = `~/.config/fish/themes/${name}.fish`;
        SyncFileHelper.create(path);
        output = await executeThemeDump(name);
        useMessageKind(this.connection, output);
        return;
      case 'execute':
      case 'executeBuffer':
        if (!params.arguments || !params.arguments[0]) {
          return;
        }
        name = params.arguments[0] as string || '';
        output = await execEntireBuffer(name);
        useMessageKind(this.connection, output);
        return;
      default:
        break;
    }
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
    this.logger.log({ currentText: current.text, currentType: current.type, symbolKind: kindString });

    const prebuiltSkipType = [
      ...PrebuiltDocumentationMap.getByType('pipe'),
      ...PrebuiltDocumentationMap.getByType('status'),
    ].find(obj => obj.name === current.text);

    // const prebuiltDoc = PrebuiltDocumentationMap.getByName(current.text);
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

    this.logger.log({ './src/server.ts:395': `this.documentationCache.resolve() found ${!!globalItem}`, docs: globalItem.docs });
    if (globalItem && globalItem.docs) {
      this.logger.log(globalItem.docs);
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
      // this.logger,
    );
    this.logger.log(fallbackHover?.contents);
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

  protected async getCodeFixes(
    fileRangeArgs: FishProtocol.FileRangeRequestArgs,
    context: LSP.CodeActionContext,
  ): Promise<FishProtocol.GetCodeFixesResponse | undefined> {
    const errorCodes = context.diagnostics.map((diagnostic) =>
      Number(diagnostic.code),
    );

    const _args: FishProtocol.CodeFixRequestArgs = {
      ...fileRangeArgs,
      errorCodes,
    };

    try {
      // return await this.connection.sendRequest(
      //   FishProtocol.CommandTypes.GetCodeFixes,
      //   args,
      // );
    } catch (err) {
      return undefined;
    }
  }
  protected async getRefactors(
    fileRangeArgs: FishProtocol.FileRangeRequestArgs,
    context: LSP.CodeActionContext,
  ): Promise<FishProtocol.GetApplicableRefactorsResponse | undefined> {
    const _args: FishProtocol.GetApplicableRefactorsRequestArgs = {
      ...fileRangeArgs,
      triggerReason:
        context.triggerKind === LSP.CodeActionTriggerKind.Invoked
          ? 'invoked'
          : undefined,
      kind: context.only?.length === 1 ? context.only[0] : undefined,
    };

    try {
      // return await this.connection.sendRequest(
      //   FishProtocol.CommandTypes.GetApplicableRefactors,
      //   args,
      // );
    } catch (err) {
      return undefined;
    }
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
    this.logger.logPropertiesForEachObject(
      flatSymbols.filter((s) => s.kind === SymbolKind.Function),
      'name',
      'range',
    );

    const folds = flatSymbols
      .filter((symbol) => symbol.kind === SymbolKind.Function)
      .map((symbol) => FishDocumentSymbol.toFoldingRange(symbol));

    folds.forEach((fold) => this.logger.log({ fold }));

    return folds;
  }

  async onCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
    this.logParams('onCodeAction', params);

    const uri = uriToPath(params.textDocument.uri);
    const document = this.docs.get(uri);

    if (!document || !uri) return [];

    const _root = this.parser.parse(document.getText()).rootNode;
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

  // works but is super slow and resource intensive, plus it doesn't really display much
  async onInlayHints(params: InlayHintParams) {
    this.logger.log({ params });

    const uri = uriToPath(params.textDocument.uri);
    const document = this.docs.get(uri);

    if (!document) return;

    return await inlayHintsProvider(
      document,
      params.range,
      //this.docs,
      this.analyzer,
      //this.config
    );
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
    this.logger.log({ line, lastCmds: lastCmd?.text });
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
    this.logger.log({ handler: methodName, params });
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

  private async startBackgroundAnalysis(): Promise<{ filesParsed: number; }> {
    // ../node_modules/vscode-languageserver/lib/common/progress.d.ts
    const notifyCallback = (text: string) => {
      if (!config.fish_lsp_show_client_popups) return;
      this.connection.window.showInformationMessage(text);
    };
    return this.analyzer.initiateBackgroundAnalysis(notifyCallback);
  }
}
