import * as LSP from 'vscode-languageserver';
import { Diagnostic, Hover, Range, Location, Position, SymbolKind, URI, WorkDoneProgressReporter, WorkspaceSymbol } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { config, getDefaultConfiguration, updateBasedOnSymbols } from './config';
import { LspDocument } from './document';
import { logger } from './logger';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol, processCompletion } from './parsing/complete';
import { getExpandedSourcedFilenameNode, isSourceCommandArgumentName, isSourceCommandWithArgument } from './parsing/source';
import { filterFirstUniqueSymbolperScope, FishSymbol, formatFishSymbolTree, processNestedTree } from './parsing/symbol';
import { implementationLocation } from './references';
import { execCommandLocations } from './utils/exec';
import { SyncFileHelper } from './utils/file-operations';
import { flattenNested, iterateNested } from './utils/flatten';
import { findParentCommand, findParentFunction, isAliasDefinitionName, isCommand, isCommandName, isOption, isTopLevelDefinition } from './utils/node-types';
import { pathToUri, symbolKindToString, uriToPath } from './utils/translation';
import { containsRange, equalRanges, getChildNodes, getNamedChildNodes, getRange, isPositionAfter, isPositionWithinRange, namedNodesGen, nodesGen, precedesRange } from './utils/tree-sitter';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { getDiagnostics } from './diagnostics/validate';
import { isExportVariableDefinitionName } from './parsing/barrel';
import { initializeParser } from './parser';
import FishServer from './server';
import server from './server';
import { connection } from './utils/startup';

/**
 * AnalyzedDocument items are created in three public methods of the Analyzer class:
 *   - analyze()
 *   - analyzePath()
 *   - analyzePartial()
 *
 * A partial AnalyzeDocument will not have the documentSymbols computed, because we
 * don't expect there to be global definitions in the document (based off of the
 * uri. i.e., $__fish_config_dir/completions/*.fish). Partial AnalyzeDocuments are
 * used to greatly reduce the overhead required for background indexing of large
 * workspaces.
 *
 * Use the AnalyzeDocument namespace to create `AnalyzedDocument` items.
 */
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
   * A tree that has been parsed by web-tree-sitter
   */
  tree: Parser.Tree;
  /**
   * root node of a SyntaxTree
   */
  root: Parser.SyntaxNode;
  /**
   * A flat array of every command used in this document
   */
  commandNodes: SyntaxNode[];
  /**
   * All the `source some_file_path` nodes in a document, scoping is not considered.
   * However, the nodes can be filtered to consider scoping at a later time.
   */
  sourceNodes: SyntaxNode[];
};

/**
 * Builder function to create an AnalyzedDocument object.
 */
export namespace AnalyzedDocument {
  export function create(
    document: LspDocument,
    documentSymbols: FishSymbol[],
    tree: Parser.Tree,
    commandNodes: SyntaxNode[] = [],
    sourceNodes: SyntaxNode[] = [],
  ): AnalyzedDocument {
    return {
      document,
      documentSymbols,
      tree,
      root: tree.rootNode,
      commandNodes,
      sourceNodes,
    };
  }

  export function createFull(
    document: LspDocument,
    documentSymbols: FishSymbol[],
    tree: Parser.Tree,
  ): AnalyzedDocument {
    const commandNodes: SyntaxNode[] = [];
    const sourceNodes: SyntaxNode[] = [];
    tree.rootNode.descendantsOfType('command').forEach(node => {
      if (isSourceCommandWithArgument(node)) sourceNodes.push(node.child(1)!);
      commandNodes.push(node);
    });
    return {
      document,
      documentSymbols,
      tree,
      root: tree.rootNode,
      commandNodes,
      sourceNodes,
    };
  }

  export function createPartial(
    document: LspDocument,
    tree: Parser.Tree,
  ): AnalyzedDocument {
    const commandNodes: SyntaxNode[] = [];
    const sourceNodes: SyntaxNode[] = [];
    tree.rootNode.descendantsOfType('command').forEach(node => {
      if (isSourceCommandWithArgument(node)) sourceNodes.push(node.child(1)!);
      commandNodes.push(node);
    });
    return {
      document,
      documentSymbols: [],
      tree,
      root: tree.rootNode,
      commandNodes,
      sourceNodes,
    };
  }

  export function isPartial(analyzedDocument: AnalyzedDocument): boolean {
    return analyzedDocument.documentSymbols.length === 0;
  }

  export function isFull(analyzedDocument: AnalyzedDocument): boolean {
    return analyzedDocument.documentSymbols.length > 0;
  }
}

/**
 * Call `await analyzer.initialize()` to create an instance of the Analyzer class.
 * This way we avoid instantiating the parser, and passing it to each analyzer
 * instance that we create (common test pattern). Also, by initializing the
 * analyzer globally, we can import it to any procedure that needs access
 * to the analyzer.
 *
 * The analyzer stores and computes our symbols, from the tree-sitter AST and
 * caches the results in AnalyzedDocument[] items.
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

  /**
   * The method that is used to instantiate the singleton `analyzer`, to avoid
   * dependency injecting the analyzer in every utility that might need it.
   *
   * This method can be called during the `connection.onInitialize()` in the server,
   * or `beforeAll()` in a test-suite.
   *
   * It is okay to use the analyzer returned for testing purposes, however for
   * consistency throughout source code, please use the exported `analyzer` variable.
   */
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
    for (const symbol of iterateNested(...analyzedDocument.documentSymbols)) {
      if (symbol.isGlobal()) this.globalSymbols.add(symbol);
    }
    return analyzedDocument;
  }

  /**
   * Take a path to a file and turns it into a LspDocument, to then be analyzed
   * and cached. This is useful for testing purposes, or for the rare occasion that
   * we need to analyze a file that is not yet a LspDocument.
   */
  public analyzePath(rawFilePath: string): AnalyzedDocument | undefined {
    const path = uriToPath(rawFilePath);
    const document = SyncFileHelper.loadDocumentSync(path);
    if (!document) {
      logger.warning(`analyzer.analyzePath: ${path} not found`);
      return undefined;
    }
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
    const analyzedDocument = AnalyzedDocument.createPartial(document, tree);
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
    return AnalyzedDocument.createFull(document, documentSymbols, tree);
  }

  /**
   * Analyze a workspace and all its documents.
   * Documents that are already analyzed will be skipped.
   * For documents that are autoloaded completions, we
   */
  public async analyzeWorkspace(
    workspace: Workspace,
    progress: WorkDoneProgressReporter | undefined = undefined,
    callbackfn: (text: string) => void = (text: string) => logger.log(`analyzer.analyzerWorkspace(${workspace.name})`, text),
  ) {
    const startTime = performance.now();
    if (workspace.isAnalyzed()) {
      callbackfn(`[fish-lsp] workspace ${workspace.name} already analyzed`);
      progress?.done();
      return { count: 0, workspace, duration: '0.00' };
    }

    // progress?.begin(workspace.name, 0, 'Analyzing workspace', true);
    const docs = workspace.pendingDocuments();
    const maxSize = Math.min(docs.length, config.fish_lsp_max_background_files);
    const currentDocuments = workspace.pendingDocuments().slice(0, maxSize);

    // Helper function to delay execution
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Calculate adaptive delay and batch size based on document count
    const BATCH_SIZE = Math.max(1, Math.floor(currentDocuments.length / 20));
    const UPDATE_DELAY = currentDocuments.length > 100 ? 10 : 25; // Shorter delay for large sets

    let lastUpdateTime = 0;
    const MIN_UPDATE_INTERVAL = 15; // Minimum ms between visual updates

    currentDocuments.forEach(async (doc, idx) => {
      try {
        if (doc.getAutoloadType() === 'completions') {
          this.analyzePartial(doc);
        } else {
          this.analyze(doc);
        }
        workspace.uris.markIndexed(doc.uri);
        const reportPercent = Math.ceil(idx / maxSize * 100);
        progress?.report(reportPercent, `Analyzing ${idx}/${docs.length} files`);
      } catch (err) {
        logger.log(`[fish-lsp] ERROR analyzing workspace '${workspace.name}' (${err?.toString() || ''})`);
      }

      const currentTime = performance.now();
      const isLastItem = idx === currentDocuments.length - 1;
      const isBatchEnd = idx % BATCH_SIZE === BATCH_SIZE - 1;
      const timeToUpdate = currentTime - lastUpdateTime > MIN_UPDATE_INTERVAL;

      if (isLastItem || isBatchEnd && timeToUpdate) {
        const percentage = Math.ceil((idx + 1) / maxSize * 100);
        progress?.report(`${percentage}% Analyzing ${idx + 1}/${maxSize} ${maxSize > 1 ? 'documents' : 'document'}`);
        lastUpdateTime = currentTime;

        // Add a small delay for visual perception
        await delay(UPDATE_DELAY);
      }
    });
    progress?.done();
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    const count = currentDocuments.length;
    const message = `Analyzed ${count} document${count > 1 ? 's' : ''} in ${duration}s`;
    callbackfn(message);
    return {
      count: currentDocuments.length,
      workspace: workspace,
      duration,
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
   * A generator function that yields all the documents in the workspace.
   */
  public * findDocumentsGen(): Generator<LspDocument> {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : true);
    for (const uri of uris) {
      const document = this.cache.getDocument(uri)?.document;
      if (document) {
        yield document;
      }
    }
  }

  /**
   * A generator function that yields all the symbols in the workspace, per document
   * The symbols yielded are flattened FishSymbols (NOT nested).
   */
  public * findSymbolsGen(): Generator<{ document: LspDocument; symbols: FishSymbol[]; }> {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : true);
    for (const uri of uris) {
      const symbols = this.cache.getFlatDocumentSymbols(uri);
      const document = this.cache.getDocument(uri)?.document;
      if (!document || !symbols) continue;
      yield { document, symbols };
    }
  }

  /**
   * A generator function that yields all the nodes in the workspace, per document.
   * The nodes yielded are using the `this.getNodes()` method, which returns the cached
   * nodes for the document.
   */
  public * findNodesGen(): Generator<{ document: LspDocument; nodes: Generator<SyntaxNode>; }> {
    const currentWs = workspaceManager.current;
    const uris = this.cache.uris().filter(uri => currentWs ? currentWs?.contains(uri) : true);
    for (const uri of uris) {
      const root = this.cache.getRootNode(uri);
      const document = this.cache.getDocument(uri)?.document;
      if (!root || !document) continue;
      yield { document, nodes: this.nodesGen(document.uri).nodes };
    }
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
    // const symbols: FishSymbol[] = [];
    // const localSymbols = this.getFlatDocumentSymbols(document.uri)
    //   .filter(s => s.containsPosition(position));
    // // .filter((s) => s.isLocal());
    // const toFind = this.wordAtPoint(document.uri, position.line, position.character);
    // const nodeToFind = this.nodeAtPoint(document.uri, position.line, position.character);
    // if (!toFind || !nodeToFind) return [];
    //
    // logger.log({
    //   getDefinitionHelper: 'Searching for definition',
    //   toFind,
    //   nodeToFind: {
    //     name: toFind,
    //     position: {
    //       line: position.line,
    //       character: position.character,
    //     },
    //     text: nodeToFind.text,
    //     type: nodeToFind.type,
    //   },
    // });
    //
    //
    // const foundLocalDefinition = localSymbols.find((s) => {
    //   return s.name === toFind
    //     && containsRange(getRange(s.focusedNode), getRange(nodeToFind))
    //     && s.scopeContainsNode(nodeToFind)
    //     && s.name === nodeToFind.text
    // });
    //
    // logger.debug({
    //   getDefinitionHelper: 'Searching for definition',
    //   foundLocalDefinition: foundLocalDefinition ? foundLocalDefinition.name : 'none',
    //   toFind,
    //   nodeToFind: {
    //     name: toFind,
    //     position: {
    //       line: position.line,
    //       character: position.character,
    //     },
    //     text: nodeToFind.text,
    //     type: nodeToFind.type,
    //   },
    // },
    //   formatFishSymbolTree(localSymbols)
    // );
    //
    // if (foundLocalDefinition) {
    //   symbols.push(foundLocalDefinition);
    //   return symbols;
    // }
    //
    // const localSymbol = localSymbols.find((s) => {
    //   return s.name === toFind && containsRange(s.selectionRange, getRange(nodeToFind));
    // });
    // if (localSymbol) {
    //   symbols.push(localSymbol);
    // } else {
    //   const toAdd: FishSymbol[] = localSymbols.filter((s) => {
    //     const variableBefore = s.kind === SymbolKind.Variable ? s.isBefore(nodeToFind) : true;
    //     return (
    //       s.name === toFind
    //       && containsRange(getRange(s.scope.scopeNode), getRange(nodeToFind))
    //       && variableBefore
    //     );
    //   });
    //   symbols.push(...toAdd);
    // }
    // if (!symbols.length) {
    //   let found = false;
    //   for (const item of this.findSymbolsGen()) {
    //     const match = item.symbols.find(s =>
    //       s.name === toFind
    //       && (s.isArgparse() && s.parent!.isGlobal()) || s.isGlobal()
    //     );
    //     if (match) {
    //       symbols.push(match);
    //       logger.debug({
    //         getDefinitionHelper: 'Found symbol in other document',
    //         symbol: match.name,
    //         uri: match.uri,
    //         position: {
    //           line: position.line,
    //           character: position.character,
    //         },
    //       });
    //       found = true;
    //       break;
    //     }
    //   }
    //   if (!found) {
    //     symbols.push(...this.globalSymbols.find(toFind));
    //   }
    // }
    // return symbols;
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
      const atPos = this.getFlatDocumentSymbols(document.uri).findLast(s =>
        s.containsPosition(position) && s.fishKind === 'ARGPARSE'
      ) || symbols.pop()!;
      logger.debug({
        isArgparseVariableDefinitionName: true,
        node: {
          text: node.text,
          type: node.type,
        },
        atPos: {
          name: atPos.name,
          uri: atPos.uri,
          position: {
            line: atPos.selectionRange.start.line,
            character: atPos.selectionRange.start.character,
          },
        }
      });
      return atPos;
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
    logger.log({
      getDefinitionLocation: 'getDefinitionLocation, checking symbol',
      symbol: {
        name: symbol?.name,
        uri: symbol?.uri,
        selectionRange: [symbol?.selectionRange.start.line,
        symbol?.selectionRange.start.character,
        symbol?.selectionRange.end.line,
        symbol?.selectionRange.end.character
        ].join(', '),
      }
    });
    if (symbol) {
      const newSymbol = filterFirstUniqueSymbolperScope(document).find((s) => {
        return s.equalDefinition(symbol);
      });
      logger.log({
        getDefinitionLocation: 'getDefinitionLocation, checking symbols',
        symbol: {
          name: symbol?.name,
          uri: symbol?.uri,
          selectionRange: [newSymbol?.selectionRange.start.line,
          symbol?.selectionRange.start.character,
          symbol?.selectionRange.end.line,
          symbol?.selectionRange.end.character
          ].join(', '),
        },
        newSymbol: {
          name: newSymbol?.name,
          uri: newSymbol?.uri,
          selectionRange: [newSymbol?.selectionRange.start.line,
          newSymbol?.selectionRange.start.character,
          newSymbol?.selectionRange.end.line,
          newSymbol?.selectionRange.end.character
          ].join(', '),
        }
      });
      if (newSymbol) {
        return [Location.create(newSymbol.uri, newSymbol.selectionRange)];
      }
    }
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
          workspaceManager.handleOpenDocument(doc);
          connection.sendNotification('workspace/didChangeWorkspaceFolders', {
            event: {
              added: [path],
              removed: [],
            },
          })
          workspaceManager.analyzePendingDocuments();
        }
        // workspaceManager.analyzePendingDocuments();
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
    const locations = implementationLocation(document, position);
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
    const { document, commandNodes } = doc;
    // get the `complete` SyntaxNode[]
    const childrenSymbols = commandNodes.filter(n => isCompletionCommandDefinition(n));
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
  public nodesGen(documentUri: string): {
    nodes: Generator<SyntaxNode>;
    namedNodes: Generator<SyntaxNode>;
  } {
    const document = this.cache.getDocument(documentUri)?.document;
    if (!document) {
      return undefined as any; // Return an empty generator if the document is not found
    }
    const root = this.getRootNode(documentUri);
    if (!root) {
      return undefined as any; // Return an empty generator if the root node is not found
    }
    return {
      nodes: nodesGen(root),
      namedNodes: namedNodesGen(root),
    };
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
   * Returns a list of all the NAMED nodes in the document.
   */
  public getNamedNodes(documentUri: string): SyntaxNode[] {
    const document = this.cache.getDocument(documentUri)?.document;
    if (!document) {
      return [];
    }
    return getNamedChildNodes(this.parser.parse(document.getText()).rootNode);
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
      if (SyncFileHelper.isDirectory(uriToPath(source))) continue;
      if (!SyncFileHelper.isFile(uriToPath(source))) continue;

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

  public commandAtPoint(
    uri: string,
    line: number,
    column: number,
  ): SyntaxNode | null {
    const node = this.nodeAtPoint(uri, line, column) ?? undefined;
    if (node && isCommand(node)) return node;
    const parentCommand = findParentCommand(node);
    return parentCommand;
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

  public ensureCachedDocument(doc: LspDocument): AnalyzedDocument {
    if (this.cache.hasUri(doc.uri)) {
      return this.cache.getDocument(doc.uri) as AnalyzedDocument;
    }
    return this.analyze(doc);
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
  getCommands(uri: URI): SyntaxNode[] {
    return this._documents.get(uri)?.commandNodes || [];
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
  clear(uri: URI) {
    this._documents.delete(uri);
  }
}
