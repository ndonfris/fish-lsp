import * as LSP from 'vscode-languageserver';
import { Connection, Diagnostic, Hover, Location, Position, SymbolKind, URI, WorkspaceSymbol } from 'vscode-languageserver';
import { ProgressWrapper } from './utils/progress-token';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { config, getDefaultConfiguration, updateBasedOnSymbols } from './config';
import { documents, LspDocument, LspDocuments } from './document';
import { logger } from './logger';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol, processCompletion } from './parsing/complete';
import { getExpandedSourcedFilenameNode, isSourceCommandArgumentName, isSourceCommandWithArgument } from './parsing/source';
import { FishSymbol, processNestedTree } from './parsing/symbol';
import { implementationLocation } from './references';
import { execCommandLocations } from './utils/exec';
import { SyncFileHelper } from './utils/file-operations';
import { flattenNested } from './utils/flatten';
import { findParentFunction, isAliasDefinitionName, isCommand, isCommandName, isOption, isTopLevelDefinition } from './utils/node-types';
import { pathToUri, symbolKindToString, uriToPath } from './utils/translation';
import { containsRange, getChildNodes, getRange, isPositionAfter, isPositionWithinRange, precedesRange } from './utils/tree-sitter';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { getDiagnostics } from './diagnostics/validate';
import { isExportVariableDefinitionName } from './parsing/barrel';
import { initializeParser } from './parser';

export type AnalyzedDocument = {
  /**
   * The LspDocument that was analyzed.
   */
  document: LspDocument;
  /**
   * A nested array of FishSymbols, representing the symbols in the document.
   */
  documentSymbols: FishSymbol[];
  /**
   * The names of every command used in this document
   */
  commands: string[];
  /**
   * A tree that has been parsed by web-tree-sitter
   */
  tree: Parser.Tree;
  /**
   * root node of a SyntaxTree
   */
  root: Parser.SyntaxNode;
  /**
   * All the `source some_file_path` nodes in a document, scoping is not considered.
   * However, the nodes can be filtered to consider scoping at a later time.
   */
  sourceNodes: SyntaxNode[];
  /**
   * All the sourced files in a document. This is a simple utility that is used
   * while searching for reachable sources from a single document. It is not
   * equivalent to all the sourced nodes that a document might recognize
   * (i.e., source of a source).
   * For all reachable sources use the methods in the analyzer class:
   * `analyzer.collectAllSources()` or `analyzer.collectReachableSources()`
   */
  sourced: Set<string>;
};

/**
 * Builder function to create an AnalyzedDocument object.
 */
export namespace AnalyzedDocument {
  export function create(
    document: LspDocument,
    documentSymbols: FishSymbol[],
    commands: string[],
    tree: Parser.Tree,
    sourceNodes: SyntaxNode[] = [],
    sourced: Set<string> = new Set(),
  ): AnalyzedDocument {
    return {
      document,
      documentSymbols,
      commands,
      tree,
      root: tree.rootNode,
      sourceNodes,
      sourced,
    };
  }
}

/**
 * Call `analyzer.initialize()` to create an instance of the Analyzer class.
 */
export let analyzer: Analyzer;

/***
 * Handles analysis of documents and caching their symbols.
 *
 * Lots of server functionality is implemented here. Including, but not limited to:
 *   - tree sitter parsing
 *   - document analysis and caching
 *   - workspace/document symbol searching
 *   - background analysis performed on startup
 *
 * Requires a tree-sitter Parser instance to be initialized for usage.
 */
export class Analyzer {
  /**
   * The cached documents from all workspaces
   *   - keys are the document uris
   *   - values are the AnalyzedDocument objects
   */
  public cache: AnalyzedDocumentCache = new AnalyzedDocumentCache();
  /**
   * All of the global symbols throughout all workspaces in the server.
   * Methods that use this cache might try to limit symbols to a single workspace.
   *
   * The `globalSymbols.map` is a used to cache the symbols for quick access
   *   - keys are the symbol names
   *   - values are the FishSymbol objects
   */
  public globalSymbols: GlobalDefinitionCache = new GlobalDefinitionCache();

  constructor(protected parser: Parser) { }

  static async initialize(): Promise<Analyzer> {
    const parser = await initializeParser();
    analyzer = new Analyzer(parser);
    return analyzer;
  }

  /**
   * Perform full analysis on a LspDocument to build a AnalyzedDocument containing
   * useful information about the document. It will also add the information to both
   * the cache of AnalyzedDocuments and the global symbols cache.
   * @param document The LspDocument to analyze.
   * @returns An AnalyzedDocument object.
   */
  public analyze(document: LspDocument): AnalyzedDocument {
    const analyzedDocument = this.getAnalyzedDocument(document);
    this.cache.setDocument(document.uri, analyzedDocument);
    const symbols = this.cache.getDocumentSymbols(document.uri);
    flattenNested(...symbols)
      .filter(s => s.isGlobal())
      .forEach((symbol: FishSymbol) => this.globalSymbols.add(symbol));
    return analyzedDocument;
  }

  /**
   * Take a path to a file and turns it into a LspDocument, to then be analyzed
   * and cached. This is useful for testing purposes, or for the rare occasion that
   * we need to analyze a file that is not yet a LspDocument.
   */
  public analyzePath(rawFilePath: string): AnalyzedDocument {
    const path = uriToPath(rawFilePath);
    const content = SyncFileHelper.read(path, 'utf-8');
    const document = LspDocument.createTextDocumentItem(pathToUri(path), content);
    return this.analyze(document);
  }

  /**
   * Use on documents where we can assume the document nodes aren't important.
   * This could mainly be summarized as any file in `$fish_complete_path/*.fish`
   * This greatly reduces the time it takes for huge workspaces to be analyzed,
   * by only retrieving the bare minimum of information required from completion
   * documents. Since completion documents are fully parsed, only once a request
   * is made that requires a completion document, we are able to avoid building their
   * document symbols here. Conversely, this means that if we were to use this method
   * instead of the
   */
  public analyzePartial(document: LspDocument): AnalyzedDocument {
    const tree = this.parser.parse(document.getText());
    const root = tree.rootNode;
    const sourceNodes: SyntaxNode[] = [];
    const commandNames: Set<string> = new Set();
    root.descendantsOfType('command').forEach(node => {
      if (isSourceCommandWithArgument(node)) sourceNodes.push(node.child(1)!);
      commandNames.add(node.text);
    });
    const analyzedDocument = AnalyzedDocument.create(document, [], Array.from(commandNames), tree, sourceNodes);
    this.cache.setDocument(document.uri, analyzedDocument);
    return analyzedDocument;
  }

  /**
   * Helper method to get the AnalyzedDocument.
   * Retrieves the parsed AST from tree-sitter's parser, processes the DocumentSymbols,
   * stores the commands used in the document, and collects all the sourced command
   * SyntaxNode's that might contain a sourced file.
   * @param LspDocument The LspDocument to analyze.
   * @returns An AnalyzedDocument object.
   */
  private getAnalyzedDocument(document: LspDocument): AnalyzedDocument {
    const tree = this.parser.parse(document.getText());
    const documentSymbols = processNestedTree(document, tree.rootNode);
    const commandNames = new Set<string>();
    const sourceNodes: SyntaxNode[] = [];
    tree.rootNode.descendantsOfType('command').forEach(node => {
      if (isSourceCommandWithArgument(node)) sourceNodes.push(node.child(1)!);
      commandNames.add(node.text);
    });
    return AnalyzedDocument.create(
      document,
      documentSymbols,
      Array.from(commandNames),
      tree,
      sourceNodes,
    );
  }

  /**
   * Analyze a workspace and all its documents.
   * Documents that are already analyzed will be skipped.
   * For documents that are autoloaded completions, we
   */
  public async analyzeWorkspace(
    workspace: Workspace,
    callbackfn: (text: string) => void = (text: string) => logger.log(text),
    progress: ProgressWrapper | undefined = undefined,
  ) {
    const startTime = performance.now();
    let count = 0;
    if (workspace.isAnalyzed()) {
      callbackfn(`[fish-lsp] workspace ${workspace.name} already analyzed`);
      progress?.done();
      return { count, workspace, duration: '0.00' };
    }
    // progress?.begin(workspace.name, 0, 'Analyzing workspace', true);
    const docs = workspace.pendingDocuments();
    const maxSize = Math.min(docs.length, config.fish_lsp_max_background_files);
    for (const doc of workspace.pendingDocuments()) {
      try {
        if (doc.getAutoloadType() === 'completions') {
          this.analyzePartial(doc);
        } else {
          this.analyze(doc);
        }
        workspace.uris.markIndexed(doc.uri);
        count++;
        const reportPercent = Math.floor(count / maxSize * 100);
        progress?.report(reportPercent, `Analyzing ${count}/${docs.length} files`);
      } catch (err) {
        logger.log(`[fish-lsp] ERROR analyzing workspace '${workspace.name}' (${err?.toString() || ''})`);
      }
    }
    progress?.done();
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    return {
      count,
      workspace: workspace,
      duration,
    };
  }

  /**
   * Analyzes all the workspaces in the server that are not already analyzed.
   * Used during the server.onInitialized() event.
   * @param connection The connection to the server (optional because `fish-lsp info --time-startup` does not have a connection)
   * @param callbackfn A function to call for logging and displaying completion in the client
   * @param progress A ProgressWrapper to report progress to the client
   * @returns An object containing the total number of files parsed, the items in each workspace, and the workspaces themselves
   */
  public async initiateBackgroundAnalysis(
    connection?: Connection,
    callbackfn: (text: string) => void = (str: string) => logger.log(str),
    progress?: ProgressWrapper,
  ): Promise<{
    totalFilesParsed: number;
    items: { [key: string]: number; };
    workspaces: Workspace[];
  }> {
    const items: { [key: string]: number; } = {};
    const startTime = performance.now();
    const allDocs: LspDocument[] = [];
    const allWorkspaces: Workspace[] = [];
    for (const workspace of workspaceManager.all) {
      if (workspace.isAnalyzed()) continue;
      allDocs.push(...workspace.pendingDocuments());
      allWorkspaces.push(workspace);
    }
    // truncate the documents to the max number of files
    if (allDocs.length >= config.fish_lsp_max_background_files) {
      allDocs.slice(0, config.fish_lsp_max_background_files);
    }
    await Promise.all(allDocs.map(async (doc, idx) => {
      if (doc.getAutoloadType() === 'completions') {
        this.analyzePartial(doc);
      } else {
        this.analyze(doc);
      }
      const workspace = workspaceManager.findContainingWorkspace(doc.uri);
      if (workspace) {
        workspace.uris.markIndexed(doc.uri);
        let currentWorkspaceCount = items[workspace.path] || 0;
        currentWorkspaceCount++;
        items[workspace.path] = currentWorkspaceCount;
        if (progress) {
          const reportPercent = Math.floor(idx / allDocs.length * 100);
          progress.report(reportPercent, `Analyzing ${idx}/${allDocs.length} files`);
        }
      }
    }));
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    callbackfn(`[fish-lsp] analyzed ${allDocs.length} files in ${allWorkspaces.length} workspaces | ${duration} seconds`);
    if (progress) progress?.done();
    return {
      totalFilesParsed: allDocs.length,
      items,
      workspaces: allWorkspaces,
    };
  }

  /**
   * Update the configuration for the current workspace based on the symbols found in the document
   *
   * This is used to update the configuration for the current workspace when a user changes
   * a fish-lsp environment variable in the workspace.
   */
  updateConfigInWorkspace(documentUri: string) {
    const workspace = workspaceManager.current;
    let symbols = this.getFlatDocumentSymbols(documentUri).filter(symbol =>
      symbol.kind === SymbolKind.Variable && Object.keys(config).includes(symbol.name),
    );
    if (!workspace || !config.fish_lsp_single_workspace_support) {
      if (symbols.length === 0) {
        const prev = config.fish_lsp_single_workspace_support;
        Object.assign(config, getDefaultConfiguration());
        config.fish_lsp_single_workspace_support = prev;
        return;
      }
      updateBasedOnSymbols(symbols);
      return;
    }
    symbols = this.findSymbols((sym, doc) => {
      if (doc && workspace.contains(doc?.uri)) return false;
      if (sym.kind === SymbolKind.Variable && Object.keys(config).includes(sym.name)) {
        return true;
      }
      return false;
    });
    if (symbols.length > 0) {
      updateBasedOnSymbols(symbols);
    }
  }

  /**
   * Removes a document, its document symbols and global symbols from the cache.
   *
   * If the document is the only open server document in the workspace, it will remove the
   * entire workspace, including all its symbols and analyzed documents.
   *
   * If the document is not the only open server document, it will only remove its symbols
   * from the cache & global symbol manager.
   *
   * @param workspace The workspace that the currentUri is in.
   * @param documents The LspDocuments manager from the server (handles opening/closing documents).
   * @param currentUri The uri of the document to be removed.
   * @returns An object containing the removedUris and removedSymbols.
   */
  public clearDocumentFromWorkspace(
    workspace: Workspace,
    documents: LspDocuments,
    currentUri: string,
  ) {
    const isOnlyDocumentInWorkspace = documents.all().filter(doc => workspace.contains(doc.uri)).length === 1;
    if (isOnlyDocumentInWorkspace) return this.clearEntireWorkspace(workspace, documents);

    const symbolsToRemove =
      this.globalSymbols.allSymbols.filter(symbol => currentUri === symbol.uri);

    const removedSymbols = new Map<LSP.DocumentUri, FishSymbol[]>();
    for (const symbol of symbolsToRemove) {
      this.globalSymbols.map.delete(symbol.name);
      const otherSymbolsInUri = removedSymbols.get(symbol.uri) || [];
      otherSymbolsInUri.push(symbol);
      removedSymbols.set(symbol.uri, otherSymbolsInUri);
    }
    documents.close(uriToPath(currentUri));

    return {
      removedUris: [currentUri],
      removedSymbols: flattenNested(...Array.from(removedSymbols.values()).flat()),
    };
  }

  /**
   * Clear the entire workspace (document symbols, global symbols, and close its LspDocuments)
   * and remove it from the workspaces.
   */
  public clearEntireWorkspace(workspace: Workspace, docsManager: LspDocuments) {
    const urisInWorkspace = this.cache.uris().filter(uri => workspace.contains(uri));
    const urisNotInOtherWorkspaces = urisInWorkspace.filter(uri => {
      return !workspaceManager.all.some((workspace) => {
        if (workspace.uri === workspace.uri) return false;
        if (workspace.uris.has(uri)) return true;
        return false;
      });
    });

    const removedUris: string[] = [];
    const removedSymbols = new Map<LSP.DocumentUri, FishSymbol[]>();
    urisNotInOtherWorkspaces.forEach(uri => {
      this.cache.clear(uri);
      removedUris.push(uri);
      if (docsManager.isOpen(uriToPath(uri))) {
        docsManager.close(uriToPath(uri));
      }
    });

    const symbolsToRemove = this.globalSymbols.allSymbols
      .filter(symbol => urisNotInOtherWorkspaces.some(uri => uri === symbol.uri));

    for (const symbol of symbolsToRemove) {
      this.globalSymbols.map.delete(symbol.name);
      const otherSymbolsInUri = removedSymbols.get(symbol.uri) || [];
      otherSymbolsInUri.push(symbol);
      removedSymbols.set(symbol.uri, otherSymbolsInUri);
    }
    workspaceManager.remove(workspace);
    return {
      removedUris,
      removedSymbols: Array.from(removedSymbols.values()).flat(),
    };
  }

  /**
   * Return the first FishSymbol seen that could be defined by the given position.
   */
  public findDocumentSymbol(
    document: LspDocument,
    position: Position,
  ): FishSymbol | undefined {
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri));
    return symbols.find((symbol) => {
      return isPositionWithinRange(position, symbol.selectionRange);
    });
  }

  /**
   * Return all FishSymbols seen that could be defined by the given position.
   */
  public findDocumentSymbols(
    document: LspDocument,
    position: Position,
  ): FishSymbol[] {
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri));
    return symbols.filter((symbol) => {
      return isPositionWithinRange(position, symbol.selectionRange);
    });
  }

  /**
   * Search through all the documents in the cache, and return the first symbol found
   * that matches the callback function.
   */
  public findSymbol(
    callbackfn: (symbol: FishSymbol, doc?: LspDocument) => boolean,
  ) {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : true);
    for (const uri of uris) {
      const symbols = this.cache.getFlatDocumentSymbols(uri);
      const document = this.cache.getDocument(uri)?.document;
      const symbol = symbols.find(s => callbackfn(s, document));
      if (symbol) {
        return symbol;
      }
    }
    return undefined;
  }

  /**
   * Search through all the documents in the cache, and return all symbols found
   */
  public findSymbols(
    callbackfn: (symbol: FishSymbol, doc?: LspDocument) => boolean,
  ): FishSymbol[] {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : true);
    const symbols: FishSymbol[] = [];
    for (const uri of uris) {
      const document = this.cache.getDocument(uri)?.document;
      const symbols = this.getFlatDocumentSymbols(document!.uri);
      const newSymbols = symbols.filter(s => callbackfn(s, document));
      if (newSymbols) {
        symbols.push(...newSymbols);
      }
    }
    return symbols;
  }

  /**
   * Search through all the documents in the cache, and return the first node found
   */
  public findNode(
    callbackfn: (n: SyntaxNode, document?: LspDocument) => boolean,
  ): SyntaxNode | undefined {
    const uris = this.cache.uris();
    for (const uri of uris) {
      const root = this.cache.getRootNode(uri);
      const document = this.cache.getDocument(uri)!.document;
      if (!root || !document) continue;
      const node = getChildNodes(root).find((n) => callbackfn(n, document));
      if (node) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Search through all the documents in the cache, and return all nodes found (with their uris)
   */
  public findNodes(
    callbackfn: (node: SyntaxNode, document: LspDocument) => boolean,
    // useCurrentWorkspace: boolean = true,
  ): {
    uri: string;
    nodes: SyntaxNode[];
  }[] {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : uri);
    const result: { uri: string; nodes: SyntaxNode[]; }[] = [];
    for (const uri of uris) {
      const root = this.cache.getRootNode(uri);
      const document = this.cache.getDocument(uri)!.document;
      if (!root || !document) continue;
      const nodes = getChildNodes(root).filter((node) => callbackfn(node, document));
      if (nodes.length > 0) {
        result.push({ uri: document.uri, nodes });
      }
    }
    return result;
  }

  /**
   * Collect all the global symbols in the workspace, and the document symbols usable
   * at the requests position. DocumentSymbols that are not in the position's scope are
   * excluded from the result array of FishSymbols.
   *
   * This method is mostly notably used for providing the symbols in
   * `server.onCompletion()` requests.
   *
   * @param document The LspDocument to search in
   * @param position The position to search at
   * @returns {FishSymbol[]} A flat array of FishSymbols that are usable at the given position
   */
  public allSymbolsAccessibleAtPosition(document: LspDocument, position: Position): FishSymbol[] {
    // Set to avoid duplicate symbols
    const symbolNames: Set<string> = new Set();
    // add the local symbols
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri))
      .filter((symbol) => symbol.scope.containsPosition(position));
    symbols.forEach((symbol) => symbolNames.add(symbol.name));
    // add the sourced symbols
    const sourcedUris = this.collectReachableSources(document.uri, position);
    for (const sourcedUri of Array.from(sourcedUris)) {
      const sourcedSymbols = this.cache.getFlatDocumentSymbols(sourcedUri)
        .filter(s =>
          !symbolNames.has(s.name)
          && isTopLevelDefinition(s.focusedNode)
          && s.uri !== document.uri,
        );
      symbols.push(...sourcedSymbols);
      sourcedSymbols.forEach((symbol) => symbolNames.add(symbol.name));
    }
    // add the global symbols
    for (const globalSymbol of this.globalSymbols.allSymbols) {
      // skip any symbols that are already in the result so that
      // next conditionals don't have to consider duplicate symbols
      if (symbolNames.has(globalSymbol.name)) continue;
      // any global symbol not in the document
      if (globalSymbol.uri !== document.uri) {
        symbols.push(globalSymbol);
        symbolNames.add(globalSymbol.name);
        // any symbol in the document that is globally scoped
      } else if (globalSymbol.uri === document.uri) {
        symbols.push(globalSymbol);
        symbolNames.add(globalSymbol.name);
      }
    }
    return symbols;
  }

  /**
   * method that returns all the workspaceSymbols that are in the same scope as the given
   * shell
   * @returns {WorkspaceSymbol[]} array of all symbols
   */
  public getWorkspaceSymbols(query: string = ''): WorkspaceSymbol[] {
    const workspace = workspaceManager.current;
    logger.log({ searching: workspace?.path, query });
    return this.globalSymbols.allSymbols
      .filter(symbol => workspace?.contains(symbol.uri) || symbol.uri === workspace?.uri)
      .map((s) => s.toWorkspaceSymbol())
      .filter((symbol: WorkspaceSymbol) => {
        return symbol.name.startsWith(query);
      });
  }

  /**
   * Utility function to get the definitions of a symbol at a given position.
   */
  private getDefinitionHelper(document: LspDocument, position: Position): FishSymbol[] {
    const symbols: FishSymbol[] = [];
    const localSymbols = this.getFlatDocumentSymbols(document.uri);
    const toFind = this.wordAtPoint(document.uri, position.line, position.character);
    const nodeToFind = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!toFind || !nodeToFind) return [];

    const localSymbol = localSymbols.find((s) => {
      return s.name === toFind && containsRange(s.selectionRange, getRange(nodeToFind));
    });
    if (localSymbol) {
      symbols.push(localSymbol);
    } else {
      const toAdd: FishSymbol[] = localSymbols.filter((s) => {
        const variableBefore = s.kind === SymbolKind.Variable ? precedesRange(s.selectionRange, getRange(nodeToFind)) : true;
        return (
          s.name === toFind
          && containsRange(getRange(s.scope.scopeNode), getRange(nodeToFind))
          && variableBefore
        );
      });
      symbols.push(...toAdd);
    }
    if (!symbols.length) {
      symbols.push(...this.globalSymbols.find(toFind));
    }
    return symbols;
  }

  /**
   * Get the first definition of a position that we can find.
   * Will first
   */
  public getDefinition(document: LspDocument, position: Position): FishSymbol | null {
    const symbols: FishSymbol[] = this.getDefinitionHelper(document, position);
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    const startTime = performance.now();
    if (node && isExportVariableDefinitionName(node)) {
      return symbols.find(s => s.name === word) || symbols.pop()!;
    }
    if (node && isAliasDefinitionName(node)) {
      return symbols.find(s => s.name === word) || symbols.pop()!;
    }
    if (node && isArgparseVariableDefinitionName(node)) {
      return this.getFlatDocumentSymbols(document.uri).findLast(s => s.containsPosition(position)) || symbols.pop()!;
    }
    if (node && isCompletionSymbol(node)) {
      logger.debug({
        isCompletionSymbol: true,
      });
      const completionSymbols = this.getFlatCompletionSymbols(document.uri);
      const completionSymbol = completionSymbols.find(s => s.equalsNode(node));
      if (!completionSymbol) {
        return null;
      }
      const symbol = this.findSymbol((s) => completionSymbol.equalsArgparse(s));
      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
      logger.debug({
        isCompletionSymbol: true,
        duration: `${duration} ms`,
        symbol: symbol?.name,
      });
      if (symbol) {
        return symbol;
      }
    }
    if (node && isOption(node)) {
      const symbol = this.findSymbol((s) => {
        if (s.parent && s.fishKind === 'ARGPARSE') {
          return node.parent?.firstNamedChild?.text === s.parent?.name &&
            s.parent.isGlobal() &&
            node.text.startsWith(s.argparseFlag);
        }
        return false;
      });
      const endTIme = performance.now();
      logger.debug({
        isOption: true,
        node: node.text,
        parent: node?.parent?.text,
        symbol: symbol?.name || '',
        duration: `${endTIme - startTime} ms`,
      });
      if (symbol) return symbol;
    }
    return symbols.pop() || null;
  }

  /**
   * Get all the definition locations of a position that we can find
   */
  public getDefinitionLocation(document: LspDocument, position: Position): LSP.Location[] {
    // handle source argument definition location
    const node = this.nodeAtPoint(document.uri, position.line, position.character);

    // check that the node (or its parent) is a `source` command argument
    if (node && isSourceCommandArgumentName(node)) {
      logger.log({
        isSourceCommandArgumentName: node.text,
        node: true,
        parent: false,
      });
      return this.getSourceDefinitionLocation(node);
    }
    if (node && node.parent && isSourceCommandArgumentName(node.parent)) {
      logger.log({
        isSourceCommandArgumentName: node.parent.text,
        node: false,
        parent: true,
      });
      return this.getSourceDefinitionLocation(node.parent);
    }

    // check if we have a symbol defined at the position
    const symbol = this.getDefinition(document, position) as FishSymbol;
    if (symbol) return [Location.create(symbol.uri, symbol.selectionRange)];

    // This is currently the only location where `config.fish_lsp_single_workspace_support` is used.
    // It allows users to go-to-definition on commands that are not in the current workspace.
    if (!config.fish_lsp_single_workspace_support && workspaceManager.current) {
      const node = this.nodeAtPoint(document.uri, position.line, position.character);
      if (node && isCommandName(node)) {
        const text = node.text.toString();
        const locations = execCommandLocations(text);
        for (const { uri, path } of locations) {
          const content = SyncFileHelper.read(path, 'utf8');
          const doc = LspDocument.createTextDocumentItem(uri, content);
          documents.open(doc);
          workspaceManager.handleOpenDocument(doc.uri);
        }
        return locations.map(({ uri }) =>
          Location.create(uri, {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          }),
        );
      }
    }
    return [];
  }

  /**
   * Here we can allow the user to use completion locations for the implementation.
   */
  public getImplementation(document: LspDocument, position: Position): Location[] {
    const definition = this.getDefinition(document, position);
    if (!definition) return [];
    const locations = implementationLocation(this, document, position);
    return locations;
  }

  /**
   * Gets the location of the sourced file for the given source command argument name node.
   */
  private getSourceDefinitionLocation(node: SyntaxNode): LSP.Location[] {
    if (node && isSourceCommandArgumentName(node)) {
      const expanded = getExpandedSourcedFilenameNode(node) as string;
      let sourceDoc = this.getDocumentFromPath(expanded);
      if (!sourceDoc) {
        this.analyzePath(expanded); // find the filepath & analyze it
        sourceDoc = this.getDocumentFromPath(expanded); // reset the sourceDoc to new value
      }
      if (sourceDoc) {
        return [
          Location.create(sourceDoc!.uri, LSP.Range.create(0, 0, 0, 0)),
        ];
      }
    }
    return [];
  }

  /**
   * Get the hover from the given position in the document, if it exists.
   * This is either a symbol, a manpage, or a fish-shell shipped function.
   * Other hovers are shown are shown if this method can't find any (defined in `./hover.ts`).
   */
  public getHover(document: LspDocument, position: Position): Hover | null {
    const tree = this.getTree(document.uri);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);

    if (!tree || !node) return null;

    const symbol =
      this.getDefinition(document, position) ||
      this.globalSymbols.findFirst(node.text);

    if (!symbol) return null;
    logger.log(`analyzer.getHover: ${symbol.name}`, {
      name: symbol.name,
      uri: symbol.uri,
      detail: symbol.detail,
      text: symbol.node.text,
      kind: symbolKindToString(symbol.kind),
    });
    return symbol.toHover();
  }

  /**
   * Returns the tree-sitter tree for the given documentUri.
   * If the document is not in the cache, it will cache it and return the tree.
   *
   * @NOTE: we use `documentUri` here instead of LspDocument's because it simplifies
   *        testing and is more consistently available in the server.
   *
   * @param documentUri - the uri of the document to get the tree for
   * @return {Tree | undefined} - the tree for the document, or undefined if the document is not in the cache
   */
  getTree(documentUri: string): Tree | undefined {
    if (this.cache.hasUri(documentUri)) {
      return this.cache.getDocument(documentUri)?.tree as Tree;
    }
    return this.analyzePath(uriToPath(documentUri))?.tree;
  }

  /**
   * Finds the rootnode given a LspDocument. If useCache is set to false, it will
   * use the parser to parse the document passed in, and then return the rootNode.
   */
  getRootNode(documentUri: string): SyntaxNode | undefined {
    return this.cache.getParsedTree(documentUri)?.rootNode;
  }

  /**
   * Returns the document from the cache. If the document is not in the cache,
   * it will return undefined.
   */
  getDocument(documentUri: string): LspDocument | undefined {
    return this.cache.getDocument(documentUri)?.document;
  }

  /**
   * Returns the document from the cache if the document is in the cache.
   */
  getDocumentFromPath(path: string): LspDocument | undefined {
    const uri = pathToUri(path);
    return this.getDocument(uri);
  }

  /**
   * Returns the FishSymbol[] array in the cache for the given documentUri.
   * The result is a nested array (tree) of FishSymbol[] items
   */
  getDocumentSymbols(documentUri: string): FishSymbol[] {
    return this.cache.getDocumentSymbols(documentUri);
  }

  /**
   * Returns the flat array of FishSymbol[] for the given documentUri.
   * Iterating through the result will allow you to reach every symbol in the documentUri.
   */
  getFlatDocumentSymbols(documentUri: string): FishSymbol[] {
    return this.cache.getFlatDocumentSymbols(documentUri);
  }

  /**
   * Returns a list of symbols similar to a DocumentSymbol array, but
   * instead of using that data type, we use our custom CompletionSymbol to define completions
   *
   * NOTE: while this method's visibility is public, it is really more of a utility
   *       for the `getGlobalArgparseLocations()` function in `src/parsing/argparse.ts`
   *
   * @param documentUri - the uri of the document to get the completions for
   * @returns {CompletionSymbol[]} - an array of CompletionSymbol objects
   */
  getFlatCompletionSymbols(documentUri: string): CompletionSymbol[] {
    const doc = this.cache.getDocument(documentUri);
    if (!doc) return [];
    const { document, root } = doc;
    // TODO: add this to the AnalyzedDocument object since it can be computed in analyzePartial and analyze
    // get the completion symbols from the document
    const childrenSymbols = root.descendantsOfType('command')
      .filter(n => isCompletionCommandDefinition(n));
    // build the CompletionSymbol[] for the entire document
    const result: CompletionSymbol[] = [];
    for (const child of childrenSymbols) {
      result.push(...processCompletion(document, child));
    }
    return result;
  }

  /**
   * Returns a list of all the nodes in the document.
   */
  public getNodes(documentUri: string): SyntaxNode[] {
    const document = this.cache.getDocument(documentUri)?.document;
    if (!document) {
      return [];
    }
    return getChildNodes(this.parser.parse(document.getText()).rootNode);
  }

  /**
   * Returns a list of all the diagnostics in the document (if the document is analyzed)
   * @param documentUri - the uri of the document to get the diagnostics for
   * @returns {Diagnostic[]} - an array of Diagnostic objects
   */
  public getDiagnostics(documentUri: string): Diagnostic[] {
    const doc = this.getDocument(documentUri);
    const root = this.getRootNode(documentUri);
    if (!doc || !root) {
      return [];
    }
    return getDiagnostics(root, doc);
  }

  /**
   * Utility to collect all the sources in the input documentUri, or if specified
   * it will only collect the included sources from the sources parameter
   * @param documentUri - the uri of the document to collect sources from
   * @param sources - the sources to collect from (optional set to narrow results)
   * @returns {Set<string>} - a flat set of all the sourceUri's reachable from the input sources
   */
  public collectSources(
    documentUri: string,
    sources = this.cache.getSources(documentUri),
  ): Set<string> {
    const visited = new Set<string>();
    const collectionStack: string[] = Array.from(sources);
    while (collectionStack.length > 0) {
      const source = collectionStack.pop()!;
      if (visited.has(source)) continue;
      visited.add(source);
      if (SyncFileHelper.isDirectory(uriToPath(source))) {
        continue;
      }
      const cahedSourceDoc = this.cache.hasUri(source)
        ? this.cache.getDocument(source) as AnalyzedDocument
        : this.analyzePath(uriToPath(source)) as AnalyzedDocument;
      if (!cahedSourceDoc) continue;
      const sourced = this.cache.getSources(cahedSourceDoc.document.uri);
      collectionStack.push(...Array.from(sourced));
    }
    return visited;
  }

  /**
   * Collects all the sourceUri's that are reachable from the given documentUri at Position
   * @param documentUri - the uri of the document to collect sources from
   * @param position - the position to collect sources from
   * @returns {Set<string>} - a set of all the sourceUri's in the document before the position
   */
  public collectReachableSources(documentUri: string, position: Position): Set<string> {
    const currentNode = this.nodeAtPoint(documentUri, position.line, position.character);
    let currentParent: SyntaxNode | null;
    if (currentNode) currentParent = findParentFunction(currentNode);
    const sourceNodes = this.cache.getSourceNodes(documentUri)
      .filter(node => {
        if (isTopLevelDefinition(node) && isPositionAfter(getRange(node).start, position)) {
          return true;
        }
        const parentFunction = findParentFunction(node);
        if (currentParent && parentFunction?.equals(currentParent) && isPositionAfter(getRange(node).start, position)) {
          return true;
        }
        return false;
      });
    const sources = new Set<string>();
    for (const node of sourceNodes) {
      const sourced = getExpandedSourcedFilenameNode(node);
      if (sourced) {
        sources.add(pathToUri(sourced));
      }
    }
    return this.collectSources(documentUri, sources);
  }

  /**
   * Collects all the sourceUri's that are in the documentUri
   * @param documentUri - the uri of the document to collect sources from
   * @returns {Set<string>} - a set of all the sourceUri's in the document
   */
  public collectAllSources(documentUri: string): Set<string> {
    const allSources = this.collectSources(documentUri);
    for (const source of Array.from(allSources)) {
      const sourceDoc = this.cache.getDocument(source);
      if (!sourceDoc) {
        this.analyzePath(source);
      }
    }
    return allSources;
  }

  /**
   * Returns an object to be deconstructed, for the onComplete function in the server.
   * This function is necessary because the normal onComplete parse of the LspDocument
   * will commonly throw errors (user is incomplete typing a command, etc.). To avoid
   * inaccurate parses for the entire document, we instead parse just the current line
   * that the user is on, and send it to the shell script to complete.
   *
   * @Note: the position should not edited (pass in the direct position from the CompletionParams)
   *
   * @returns
   *        line - the string output of the line the cursor is on
   *        lineRootNode - the rootNode for the line that the cursor is on
   *        lineCurrentNode - the last node in the line
   */
  public parseCurrentLine(
    document: LspDocument,
    position: Position,
  ): {
    line: string;
    word: string;
    lineRootNode: SyntaxNode;
    lineLastNode: SyntaxNode;
  } {
    const line = document
      .getLineBeforeCursor(position)
      .replace(/^(.*)\n$/, '$1') || '';
    const word =
      this.wordAtPoint(
        document.uri,
        position.line,
        Math.max(position.character - 1, 0),
      ) || '';
    const lineRootNode = this.parser.parse(line).rootNode;
    const lineLastNode = lineRootNode.descendantForPosition({
      row: 0,
      column: line.length - 1,
    });
    return { line, word, lineRootNode, lineLastNode };
  }
  public wordAtPoint(
    uri: string,
    line: number,
    column: number,
  ): string | null {
    const node = this.nodeAtPoint(uri, line, column);

    if (!node || node.childCount > 0 || node.text.trim() === '') {
      return null;
    }

    // check if the current word is a node that contains a `=` sign, therefore
    // we don't want to return the whole word, but only the part before the `=`
    if (
      isAliasDefinitionName(node) ||
      isExportVariableDefinitionName(node)
    ) return node.text.split('=')[0]!.trim();

    return node.text.trim();
  }
  /**
   * Find the node at the given point.
   */
  public nodeAtPoint(
    uri: string,
    line: number,
    column: number,
  ): Parser.SyntaxNode | null {
    const tree = this.cache.getParsedTree(uri);
    if (!tree?.rootNode) {
      // Check for lacking rootNode (due to failed parse?)
      return null;
    }
    return tree.rootNode.descendantForPosition({ row: line, column });
  }

  /**
   * Find the name of the command at the given point.
   */
  public commandNameAtPoint(
    uri: string,
    line: number,
    column: number,
  ): string | null {
    let node = this.nodeAtPoint(uri, line, column);

    while (node && !isCommand(node)) {
      node = node.parent;
    }

    if (!node) return null;

    const firstChild = node.firstNamedChild;
    if (!firstChild || !isCommandName(firstChild)) return null;

    return firstChild.text.trim();
  }

  /**
   * Get the text at the given location, using the range of the location to find the text
   * inside the range.
   * Super helpful for debugging Locations like references, renames, definitions, etc.
   */
  public getTextAtLocation(location: LSP.Location): string {
    const document = this.cache.getDocument(location.uri);
    if (!document) {
      return '';
    }
    const text = document.document.getText(location.range);
    return text;
  }
}

/**
 * The cache for all of the analyzer's global FishSymbol's across all workspaces
 * analyzed.
 *
 * The enternal map uses the name of the symbol as the key, and the value is an array
 * of FishSymbol's that have the same name. This is because a symbol can be defined
 * multiple times in different scopes/workspaces, and we want to keep track of all of them.
 */
class GlobalDefinitionCache {
  constructor(private _definitions: Map<string, FishSymbol[]> = new Map()) { }
  add(symbol: FishSymbol): void {
    const current = this._definitions.get(symbol.name) || [];
    if (!current.some(s => s.equals(symbol))) {
      current.push(symbol);
    }
    this._definitions.set(symbol.name, current);
  }
  find(name: string): FishSymbol[] {
    return this._definitions.get(name) || [];
  }
  findFirst(name: string): FishSymbol | undefined {
    const symbols = this.find(name);
    if (symbols.length === 0) {
      return undefined;
    }
    return symbols[0];
  }
  has(name: string): boolean {
    return this._definitions.has(name);
  }
  uniqueSymbols(): FishSymbol[] {
    const unique: FishSymbol[] = [];
    this.allNames.forEach(name => {
      const u = this.findFirst(name);
      if (u) {
        unique.push(u);
      }
    });
    return unique;
  }
  get allSymbols(): FishSymbol[] {
    const all: FishSymbol[] = [];
    for (const [_, symbols] of this._definitions.entries()) {
      all.push(...symbols);
    }
    return all;
  }
  get allNames(): string[] {
    return [...this._definitions.keys()];
  }
  get map(): Map<string, FishSymbol[]> {
    return this._definitions;
  }
}

/**
 * The cache for all of the analyzed documents in the server.
 *
 * The internal map uses the uri of the document as the key, and the value is
 * the AnalyzedDocument object that contains:
 *   - LspDocument
 *   - FishSymbols (the definitions in the Document)
 *   - tree (from tree-sitter)
 *   - `source` command arguments, SyntaxNode[]
 *   - commands used in the document (array of strings)
 */
class AnalyzedDocumentCache {
  constructor(private _documents: Map<URI, AnalyzedDocument> = new Map()) { }
  uris(): string[] {
    return [...this._documents.keys()];
  }
  setDocument(uri: URI, analyzedDocument: AnalyzedDocument): void {
    this._documents.set(uri, analyzedDocument);
  }
  getDocument(uri: URI): AnalyzedDocument | undefined {
    if (!this._documents.has(uri)) {
      return undefined;
    }
    return this._documents.get(uri);
  }
  hasUri(uri: URI): boolean {
    return this._documents.has(uri);
  }
  updateUri(oldUri: URI, newUri: URI): void {
    const oldValue = this.getDocument(oldUri);
    if (oldValue) {
      this._documents.delete(oldUri);
      this._documents.set(newUri, oldValue);
    }
  }
  getDocumentSymbols(uri: URI): FishSymbol[] {
    return this._documents.get(uri)?.documentSymbols || [];
  }
  getFlatDocumentSymbols(uri: URI): FishSymbol[] {
    return flattenNested<FishSymbol>(...this.getDocumentSymbols(uri));
  }
  getCommands(uri: URI): string[] {
    return this._documents.get(uri)?.commands || [];
  }
  getRootNode(uri: URI): Parser.SyntaxNode | undefined {
    return this.getParsedTree(uri)?.rootNode;
  }
  getParsedTree(uri: URI): Parser.Tree | undefined {
    return this._documents.get(uri)?.tree;
  }
  getSymbolTree(uri: URI): FishSymbol[] {
    const document = this.getDocument(uri);
    if (!document) {
      return [];
    }
    return document.documentSymbols;
  }
  getSources(uri: URI): Set<string> {
    const document = this.getDocument(uri);
    if (!document) {
      return new Set();
    }
    const result: Set<string> = new Set();
    const sourceNodes = document.sourceNodes.map(node => getExpandedSourcedFilenameNode(node)).filter(s => !!s) as string[];
    for (const source of sourceNodes) {
      const sourceUri = pathToUri(source);
      result.add(sourceUri);
    }
    return result;
  }
  getSourceNodes(uri: URI): SyntaxNode[] {
    const document = this.getDocument(uri);
    if (!document) {
      return [];
    }
    return document.sourceNodes;
  }
  /**
   * Name is a string that will be searched across all symbols in cache. tree-sitter-fish
   * type of symbols that will be searched is 'word' (i.e. variables, functions, commands)
   * @param {string} name - string SyntaxNode.name to search in cache
   * @returns {map<URI, SyntaxNode[]>} - map of URIs to SyntaxNodes that match the name
   */
  findMatchingNames(name: string): Map<URI, SyntaxNode[]> {
    const matches = new Map<URI, SyntaxNode[]>();
    this.forEach((uri, doc) => {
      const root = doc.tree.rootNode;
      const nodes = root.descendantsOfType('word').filter(node => node.text === name);
      if (nodes.length > 0) {
        matches.set(uri, nodes);
      }
    });
    return matches;
  }
  forEach(callbackfn: (uri: URI, document: AnalyzedDocument) => void): void {
    for (const [uri, document] of this._documents) {
      callbackfn(uri, document);
    }
  }
  filter(callbackfn: (uri: URI, document?: AnalyzedDocument) => boolean): AnalyzedDocument[] {
    const result: AnalyzedDocument[] = [];
    this.forEach((currentUri, currentDocument) => {
      if (callbackfn(currentUri, currentDocument)) {
        result.push(currentDocument);
      }
    });
    return result;
  }
  mapUris<U>(callbackfn: (doc: AnalyzedDocument) => U, uris: URI[] = this.uris()): U[] {
    const result: U[] = [];
    for (const uri of uris) {
      const doc = this.getDocument(uri);
      if (!doc) {
        continue;
      }
      result.push(callbackfn(doc));
    }
    return result;
  }
  clear(uri: URI) {
    this._documents.delete(uri);
  }
}
