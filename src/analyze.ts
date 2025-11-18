import * as LSP from 'vscode-languageserver';
import { DocumentUri, Hover, Location, Position, SymbolKind, URI, WorkDoneProgressReporter, WorkspaceSymbol } from 'vscode-languageserver';
import { dirname } from 'path';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { config } from './config';
import { LspDocument } from './document';
import { logger } from './logger';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol, processCompletion } from './parsing/complete';
import { createSourceResources, getExpandedSourcedFilenameNode, isSourceCommandArgumentName, isSourceCommandWithArgument, symbolsFromResource } from './parsing/source';
import { filterFirstPerScopeSymbol, FishSymbol, processNestedTree } from './parsing/symbol';
import { getImplementation } from './references';
import { execCommandLocations } from './utils/exec';
import { SyncFileHelper } from './utils/file-operations';
import { flattenNested, iterateNested } from './utils/flatten';
import { findParentCommand, findParentFunction, isAliasDefinitionName, isCommand, isCommandName, isOption, isTopLevelDefinition, isExportVariableDefinitionName } from './utils/node-types';
import { pathToUri, symbolKindToString, uriToPath } from './utils/translation';
import { containsRange, getChildNodes, getNamedChildNodes, getRange, isPositionAfter, isPositionWithinRange, namedNodesGen, nodesGen, precedesRange } from './utils/tree-sitter';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { initializeParser } from './parser';
import { connection } from './utils/startup';
import { DiagnosticCache } from './diagnostics/cache';

/*************************************************************/
/*     ts-doc type imports for links to other files here     */
/*************************************************************/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { FishServer } from './server'; // @ts-ignore

/*************************************************************/

/**
 * Type of AnalyzedDocument, either 'partial' or 'full'.
 * - 'partial' documents do not have all properties computed,
 * - 'full' documents have all properties computed.
 *
 * @see {@link AnalyzedDocument#isPartial()} check if the document is partially parsed.
 * @see {@link AnalyzedDocument#isFull()} check if the document is fully parsed.
 *
 * @see {@link AnalyzedDocument#ensureParsed()} convert any partial documents to full ones and update {@link analyzer.cache}.
 */
export type AnalyzedDocumentType = 'partial' | 'full';
export type EnsuredAnalyzeDocument = Required<AnalyzedDocument> & { root: SyntaxNode; tree: Tree; type: 'full'; };

/**
 * Specialized type of AnalyzedDocument that guarantees all the properties
 * are present so that consumers can avoid null checks once they have already
 * ensured the document is fully analyzed.
 *
 * This type will be returned from the `AnalyzedDocument.ensureParsed()` method,
 * which makes sure any partial documents are fully computed and updated.
 * @see {@link AnalyzedDocument#ensureParsed()}
 */
export type EnsuredAnalyzeDocument = Required<AnalyzedDocument> & { root: SyntaxNode; tree: Tree; type: 'full'; };

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
export class AnalyzedDocument {
  /**
   * private constructor to enforce the use of static creation methods.
   * @see {@link AnalyzedDocument.create()} for usage.
   *
   * @param document The LspDocument that was analyzed.
   * @param documentSymbols A nested array of FishSymbols, representing the symbols in the document.
   * @param tree A tree that has been parsed by web-tree-sitter
   * @param root root node of a SyntaxTree
   * @param commandNodes A flat array of every command used in this document
   * @param sourceNodes All the `source some_file_path` nodes in a document, scoping is not considered.
   * However, the nodes can be filtered to consider scoping at a later time.
   * @param type If the document has been fully analyzed, or only partially.
   *
   * @returns An instance of AnalyzedDocument.
   */
  private constructor(
    /**
     * The LspDocument that was analyzed.
     */
    public document: LspDocument,
    /**
     * A nested array of FishSymbols, representing the symbols in the document.
     */
    public documentSymbols: FishSymbol[] = [],
    /**
     * A tree that has been parsed by web-tree-sitter
     */
    public tree?: Parser.Tree,
    /**
     * root node of a SyntaxTree
     */
    public root?: Parser.SyntaxNode,
    /**
     * A flat array of every command used in this document
     */
    public commandNodes: SyntaxNode[] = [],
    /**
     * All the `source some_file_path` nodes in a document, scoping is not considered.
     * However, the nodes can be filtered to consider scoping at a later time.
     */
    public sourceNodes: SyntaxNode[] = [],
    /**
     * If the document has been fully analyzed, or only partially.
     */
    private type: AnalyzedDocumentType = tree ? 'full' : 'partial',
  ) {
    if (tree) this.root = tree.rootNode || undefined;
  }

  /**
   * Static method to create an AnalyzedDocument. If passed a tree, it will
   * be considered a fully parsed document. Otherwise, it will be considered a partial document.
   *
   * @see {@link AnalyzedDocument.createFull()} {@link AnalyzedDocument.createPartial()}
   *
   * @param document The LspDocument that was analyzed.
   * @param documentSymbols A nested array of FishSymbols, representing the symbols in the document.
   * @param tree A tree that has been parsed by web-tree-sitter
   * @param root root node of a SyntaxTree
   * @param commandNodes A flat array of every command used in this document
   * @param sourceNodes All the `source some_file_path` nodes in a document, scoping is not considered.
   *
   * @returns An instance of AnalyzedDocument returned from createdFull() or createdPartial().
   */
  private static create(
    document: LspDocument,
    documentSymbols: FishSymbol[] = [],
    tree: Parser.Tree | undefined = undefined,
    root: Parser.SyntaxNode | undefined = undefined,
    commandNodes: SyntaxNode[] = [],
    sourceNodes: SyntaxNode[] = [],
  ): AnalyzedDocument {
    return new AnalyzedDocument(
      document,
      documentSymbols,
      tree,
      root || tree?.rootNode,
      commandNodes,
      sourceNodes,
      tree ? 'full' : 'partial',
    );
  }

  /**
   * Static method to create a fully parsed AnalyzedDocument.
   * Extracts both the commandNodes and sourceNodes from the tree provided.
   *
   * @see {@link AnalyzedDocument.create()} which handles initialization internally.
   *
   * @param document The LspDocument that was analyzed.
   * @param documentSymbols A nested array of FishSymbols, representing the symbols in the document.
   * @param tree A tree that has been parsed by web-tree-sitter
   *
   * @returns An instance of AnalyzedDocument, with all properties populated.
   */
  public static createFull(
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
    return new AnalyzedDocument(
      document,
      documentSymbols,
      tree,
      tree.rootNode,
      commandNodes,
      sourceNodes,
      'full',
    );
  }

  /**
   * Static method to create a partially parsed AnalyzedDocument. Partial documents
   * do not compute any expensive properties such as documentSymbols, commandNodes, or sourceNodes.
   *
   * This saves significant time during initial workspace analysis, especially for large workspaces
   * by assuming certain documents (such as those in completions directories) do not contain
   * global `FishSymbol[]` definitions. We can then lazily compute partial documents
   * by checking if opened/changed documents had references to lazily loaded documents.
   *
   * @see {@link AnalyzedDocument.create()} which handles initialization internally.
   * @see {@link AnalyzedDocument#ensureParsed()} to fully parse a partial document when needed.
   *
   * @param document The LspDocument that was analyzed.
   *
   * @returns An instance of AnalyzedDocument, with only the document property populated.
   */
  public static createPartial(document: LspDocument): AnalyzedDocument {
    return AnalyzedDocument.create(document);
  }

  /**
   * Check if the AnalyzedDocument is partial (not fully parsed).
   * @see {@link AnalyzedDocument#ensureParsed()} which will convert a partial document to a full one.
   * @returns {boolean} True if the AnalyzedDocument is partial, false otherwise.
   */
  public isPartial(): boolean {
    return this.type === 'partial';
  }

  /**
   * Check if the AnalyzedDocument is fully parsed.
   * @returns {boolean} True if the AnalyzedDocument is full, false otherwise.
   */
  public isFull(): boolean {
    return this.type === 'full';
  }

  /**
   * Type guard to be used when a AnalyzedDocument is expected to be fully parsed.
   * AnalyzedDocuments that are partial will compute their missing properties, in
   * order to become fully parsed AnalyzedDocuments here. When a document is computed
   * in this method, it will automatically be updated in the {@link analyzer.cache}
   * so that future requests easily stay in sync.
   *
   * If the AnalyzedDocument is already fully parsed, we simply return the
   * current instance without any modifications.
   *
   * @see {@link AnalyzedDocument.createPartial()} for creating partial documents.
   * @see {@link AnalyzedDocument.createFull()} for creating fully parsed documents.
   * @see {@link EnsuredAnalyzeDocument} strict type definition of our ReturnType
   * which guarantees all properties are present so we can avoid null checks.
   *
   * @returns EnsuredAnalyzeDocument The fully parsed AnalyzedDocument.
   */
  public ensureParsed(): EnsuredAnalyzeDocument {
    if (this.isPartial()) {
      const fullDocument = analyzer.analyze(this.document);
      // Update this instance's properties in-place
      this.documentSymbols = fullDocument.documentSymbols;
      this.tree = fullDocument.tree;
      this.root = fullDocument.root;
      this.commandNodes = fullDocument.commandNodes;
      this.sourceNodes = fullDocument.sourceNodes;
      this.type = 'full';

      // Update the cache with the fully parsed document
      analyzer.cache.setDocument(this.document.uri, this);
      return this as EnsuredAnalyzeDocument;
    }
    return this as EnsuredAnalyzeDocument;
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

  public started = false;

  public diagnostics: DiagnosticCache = new DiagnosticCache();

  constructor(public parser: Parser) { }

  /**
   * The method that is used to instantiate the **singleton** {@link analyzer}, to avoid
   * dependency injecting the analyzer in every utility that might need it.
   *
   * This method can be called during the `connection.onInitialize()` in the server,
   * or {@link https://vitest.dev/ | vite.beforeAll()} in a test-suite.
   *
   * @example
   * ```typescript
   * // file: ./tests/some-test-file.test.ts
   * import { Analyzer, analyzer } from '../src/analyze';
   *
   * // Initialize the `analyzer` singleton through the `Analyzer.initialize()`
   * // method to make it available throughout testing. This helps keep tests
   * // consistent with the analysis functionality used throughout entire server.
   *
   * describe('test suite', () => {
   *     // Make sure the analyzer is initialized before any tests run
   *      beforeAll(async () => {
   *          await Analyzer.initialize();
   *          // analyzer.parser exists if needed
   *          // we can also use analyzer anywhere now in the test file
   *      });
   *      it('test 1', () => {
   *          const result1 = analyzer.analyzePath('/path/to/file.fish');
   *          const result2 = analyzer.analyze(result1.document);
   *          expect(result1.document.uri).toBe(result2.document.uri);
   *      });
   *      it('test 2', () => {
   *          const tree = analyzer.parser.parse('fish --help')
   *          const { rootNode } = tree;
   *          expect(rootNode).toBeDefined();
   *      });
   *      // ...
   * });
   * ```
   *
   * ___
   *
   * It is okay to use the {@link Analyzer} returned for testing purposes, however for
   * consistency throughout source code, please use the exported {@link analyzer} variable.
   *
   * @returns Promise<Analyzer> The initialized Analyzer instance (recommended to directly import {@link analyzer}).
   */
  public static async initialize(): Promise<Analyzer> {
    const parser = await initializeParser();
    analyzer = new Analyzer(parser);
    analyzer.started = true;
    return analyzer;
  }

  /**
   * Perform full analysis on a LspDocument to build a AnalyzedDocument containing
   * useful information about the document. It will also add the information to both
   * the cache of AnalyzedDocuments and the global symbols cache.
   *
   * @param document The {@link LspDocument} to analyze.
   * @returns An {@linkcode AnalyzedDocument} object.
   */
  public analyze(document: LspDocument): AnalyzedDocument {
    const analyzedDocument = this.getAnalyzedDocument(document);
    this.cache.setDocument(document.uri, analyzedDocument);

    // Remove old global symbols for this document before adding new ones
    this.globalSymbols.removeSymbolsByUri(document.uri);

    // Add new global symbols
    for (const symbol of iterateNested(...analyzedDocument.documentSymbols)) {
      if (symbol.isGlobal()) this.globalSymbols.add(symbol);
    }
    return analyzedDocument;
  }

  /**
   * Remove all global symbols for a document (used when document is closed or deleted)
   */
  public removeDocumentSymbols(uri: string): void {
    this.globalSymbols.removeSymbolsByUri(uri);
    this.cache.clear(uri);
  }

  /**
   * @summary
   * Takes a path to a file and turns it into a LspDocument, to then be analyzed
   * and cached. This is useful for testing purposes, or for the rare occasion that
   * we need to analyze a file that is not yet a LspDocument.
   *
   * @param filepath The local machine's path to the document that needs resolution
   * @returns AnalyzedDocument {@link @AnalyzedDocument} or undefined if the file could not be found.
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
   * @public
   * Use on documents where we can assume the document nodes aren't important.
   * This could mainly be summarized as any file in `$fish_complete_path/*.fish`
   * This greatly reduces the time it takes for huge workspaces to be analyzed,
   * by only retrieving the bare minimum of information required from completion
   * documents. Since completion documents are fully parsed, only once a request
   * is made that requires a completion document, we are able to avoid building
   * their document symbols here. Conversely, this means that if we were to use
   * this method instead of the full `analyze()` method, any requests that need
   * symbols from the document will not be able to retrieve them.
   *
   * @see {@link AnalyzedDocument#ensureParsed()} convert a partial document to a full one
   * and update the {@link analyzer.cache} with the newly computed full document.
   *
   * @param document The {@link LspDocument} to analyze.
   * @returns partial result of {@link AnalyzedDocument.createPartial()} with no computed
   *          properties set, which we use {@link FishServer#didChangeTextDocument()}
   *          to later ensure any reachable symbols are computed local to the open document.
   */
  public analyzePartial(document: LspDocument): AnalyzedDocument {
    const analyzedDocument = AnalyzedDocument.createPartial(document);
    this.cache.setDocument(document.uri, analyzedDocument);
    return analyzedDocument;
  }

  /**
   * @private
   *
   * Helper method to get the AnalyzedDocument. Retrieves the parsed
   * AST from {@link https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web | web-tree-sitter's} {@link Parser},
   *
   * - processes the {@link DocumentSymbol},
   * - stores the commands used in the document,
   * - collects all the sourced command {@link SyntaxNode}'s arguments
   *   **(potential file paths)**
   *
   * @param LspDocument The {@link LspDocument} to analyze.
   * @returns An {@link AnalyzedDocument} object.
   */
  private getAnalyzedDocument(document: LspDocument): AnalyzedDocument {
    const tree = this.parser.parse(document.getText());
    const documentSymbols = processNestedTree(document, tree.rootNode);
    return AnalyzedDocument.createFull(document, documentSymbols, tree);
  }

  /**
   * Analyze a workspace and all its documents.
   * Documents that are already analyzed will be skipped.
   * For documents that are autoloaded completions, we only perform a partial analysis.
   * This method also reports progress to the provided WorkDoneProgressReporter.
   *
   * @param workspace The workspace to analyze.
   * @param progress Optional WorkDoneProgressReporter to report progress.
   * @param callbackfn Optional callback function to report messages.
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
   * Return the first FishSymbol seen that matches is defined at the location passed in
   */
  public getSymbolAtLocation(location: Location): FishSymbol | undefined {
    const symbols = this.cache.getFlatDocumentSymbols(location.uri);
    return symbols.find((symbol) => symbol.equalsLocation(location));
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
    for (const uri of this.getIterableUris()) {
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
    const symbols: FishSymbol[] = [];
    for (const uri of this.getIterableUris()) {
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
    const result: { uri: string; nodes: SyntaxNode[]; }[] = [];
    for (const uri of this.getIterableUris()) {
      const root = this.cache.getRootNode(uri);
      const document = this.cache.getDocument(uri)?.document;
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
    for (const uri of this.getIterableUris()) {
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
    for (const uri of this.getIterableUris()) {
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
    for (const uri of this.getIterableUris()) {
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
          && (s.isGlobal() || s.isRootLevel())
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
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!word || !node) return [];

    // First check local symbols
    const localSymbols = this.getFlatDocumentSymbols(document.uri);
    const localSymbol = localSymbols.find((s) => {
      return s.name === word && containsRange(s.selectionRange, getRange(node));
    });
    if (localSymbol) {
      symbols.push(localSymbol);
    } else {
      const toAdd: FishSymbol[] = localSymbols.filter((s) => {
        const variableBefore = s.kind === SymbolKind.Variable ? precedesRange(s.selectionRange, getRange(node)) : true;
        return (
          s.name === word
          && containsRange(getRange(s.scope.scopeNode), getRange(node))
          && variableBefore
        );
      });
      symbols.push(...toAdd);
    }

    // If no local symbols found, check sourced symbols
    if (!symbols.length) {
      const allAccessibleSymbols = this.allSymbolsAccessibleAtPosition(document, position);
      const sourcedSymbols = allAccessibleSymbols.filter(s =>
        s.name === word && s.uri !== document.uri,
      );
      symbols.push(...sourcedSymbols);
    }

    // Finally, check global symbols as fallback
    if (!symbols.length) {
      symbols.push(...this.globalSymbols.find(word));
    }

    return symbols;
  }

  /**
   * Get the first definition of a position that we can find.
   * Will first retrieve {@link Analyzer#getDefinitionHelper()} to look for possible definitions.
   * Symbols found are then handled based on their node type, to ensure we return the most relevant definition.
   * If symbol exists, but doesn't match any of the special cases, we return the last symbol found.
   */
  public getDefinition(document: LspDocument, position: Position): FishSymbol | null {
    const symbols: FishSymbol[] = this.getDefinitionHelper(document, position);
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    if (node && isExportVariableDefinitionName(node)) {
      return symbols.find(s => s.name === word) || symbols.pop()!;
    }
    if (node && isAliasDefinitionName(node)) {
      return symbols.find(s => s.name === word) || symbols.pop()!;
    }
    if (node && isArgparseVariableDefinitionName(node)) {
      const atPos = this.getFlatDocumentSymbols(document.uri).findLast(s =>
        s.containsPosition(position) && s.fishKind === 'ARGPARSE',
      ) || symbols.pop()!;
      return atPos;
    }
    if (node && isCompletionSymbol(node)) {
      const completionSymbols = this.getFlatCompletionSymbols(document.uri);
      const completionSymbol = completionSymbols.find(s => s.equalsNode(node));
      if (!completionSymbol) {
        return null;
      }
      const symbol = this.findSymbol((s) => completionSymbol.equalsArgparse(s));
      if (symbol) return symbol;
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
      return this.getSourceDefinitionLocation(node, document);
    }
    if (node && node.parent && isSourceCommandArgumentName(node.parent)) {
      return this.getSourceDefinitionLocation(node.parent, document);
    }

    // check if we have a symbol defined at the position
    const symbol = this.getDefinition(document, position) as FishSymbol;
    if (symbol) {
      if (symbol.isEvent()) return [symbol.toLocation()];

      const newSymbol = filterFirstPerScopeSymbol(document.uri)
        .find((s) => s.equalDefinition(symbol));

      if (newSymbol) return [newSymbol.toLocation()];
    }
    if (symbol) return [symbol.toLocation()];

    // allow execCommandLocations to provide location for command when no other
    // definition has been found. Previously, config.fish_lsp_single_workspace_support
    // was used to prevent this case from being hit but now we always allow it.
    if (workspaceManager.current) {
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
          });
          workspaceManager.analyzePendingDocuments();
        }
        // consider just finding the definition symbol since we analyze the document
        // with the above `workspaceManager.handleOpenDocument(doc)` call
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
    const locations = getImplementation(document, position);
    return locations;
  }

  /**
   * Gets the location of the sourced file for the given source command argument name node.
   */
  private getSourceDefinitionLocation(node: SyntaxNode, document: LspDocument): LSP.Location[] {
    if (node && isSourceCommandArgumentName(node)) {
      // Get the base directory for resolving relative paths
      const fromPath = uriToPath(document.uri);
      const baseDir = dirname(fromPath);

      const expanded = getExpandedSourcedFilenameNode(node, baseDir) as string;
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
      const doc = this.cache.getDocument(documentUri);
      if (doc) {
        return doc.ensureParsed().tree;
      }
    }
    return this.analyzePath(uriToPath(documentUri))?.tree;
  }

  /**
   * gets/finds the rootNode given a DocumentUri. if cached it will return the root from the cache,
   * Otherwise it will analyze the path and return the root node, which might not be possible if the path
   * is not readable or the file does not exist.
   * @see {@link https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web | web-tree-sitter's} {@link SyntaxNode}
   * @param documentUri - the uri of the document to get the root node for
   * @return {SyntaxNode | undefined} - the root node for the document, or undefined if the document is not in the cache
   */
  getRootNode(documentUri: string): SyntaxNode | undefined {
    if (this.cache.hasUri(documentUri)) {
      const doc = this.cache.getDocument(documentUri);
      if (doc) {
        return doc.ensureParsed().root;
      }
    }
    return this.analyzePath(uriToPath(documentUri))?.root;
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
      return { nodes: (function* () { })(), namedNodes: (function* () { })() }; // Return an empty generator if the document is not found
    }
    const root = this.getRootNode(documentUri);
    if (!root) {
      return { nodes: (function* () { })(), namedNodes: (function* () { })() }; // Return an empty generator if the root node is not found
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

  // /**
  //  * Returns a list of all the diagnostics in the document (if the document is analyzed)
  //  * @param documentUri - the uri of the document to get the diagnostics for
  //  * @returns {Diagnostic[]} - an array of Diagnostic objects
  //  */
  // public getDiagnostics(documentUri: string) {
  //   return this.diagnostics.bindDiagnostics(documentUri);
  // }

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

    // Get the base directory for resolving relative paths
    const fromPath = uriToPath(documentUri);
    const baseDir = dirname(fromPath);

    for (const node of sourceNodes) {
      const sourced = getExpandedSourcedFilenameNode(node, baseDir);
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
   * Collects all sourced symbols for a document, including symbols from all reachable source files.
   * This is used for document symbols to include sourced functions and variables.
   * @param documentUri - the uri of the document to collect sourced symbols for
   * @returns {FishSymbol[]} - array of all sourced symbols (functions, variables) that should be visible
   */
  public collectSourcedSymbols(documentUri: string): FishSymbol[] {
    const sourcedSymbols: FishSymbol[] = [];
    const uniqueNames = new Set<string>();

    // Get all sourced files reachable from this document
    const sourcedUris = this.collectAllSources(documentUri);

    for (const sourcedUri of sourcedUris) {
      if (sourcedUri === documentUri) continue; // Skip self

      // Create a mock SourceResource for symbolsFromResource
      const sourceDoc = this.getDocument(sourcedUri);
      if (!sourceDoc) continue;

      const topLevelDefinitions = this.getFlatDocumentSymbols(sourceDoc.uri).filter(s => s.isRootLevel() || s.isGlobal());
      sourcedSymbols.push(...topLevelDefinitions);

      for (const resource of createSourceResources(analyzer, sourceDoc)) {
        // If the resource is a sourced file, we can get its symbols
        if (resource.to && resource.from && resource.node) {
          const symbols = symbolsFromResource(this, resource, new Set(sourcedSymbols.map(s => s.name)))
            .filter(s => s.isRootLevel() || s.isGlobal());
          for (const symbol of symbols) {
            if (!uniqueNames.has(symbol.name)) {
              uniqueNames.add(symbol.name);
              sourcedSymbols.push(symbol);
            }
          }
        }
      }
    }

    return sourcedSymbols;
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
      const cachedDoc = this.cache.getDocument(doc.uri);
      if (cachedDoc?.document.version === doc.version && cachedDoc.document.getText() === doc.getText()) {
        return cachedDoc;
      }
    }
    return this.analyze(doc);
  }

  private getIterableUris(): DocumentUri[] {
    const currentWs = workspaceManager.current;
    if (currentWs) {
      return currentWs.uris.all;
    }
    return this.cache.uris();
  }
}

/**
 * @local
 * @class GlobalDefinitionCache
 *
 * @summary The cache for all of the analyzer's global FishSymbol's across all workspaces
 * analyzed.
 *
 * The enternal map uses the name of the symbol as the key, and the value is an array
 * of FishSymbol's that have the same name. This is because a symbol can be defined
 * multiple times in different scopes/workspaces, and we want to keep track of all of them.
 *
 * @see {@link analyzer.globalSymbols} the globally accessible location of this class
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
  removeSymbolsByUri(uri: string): void {
    for (const [name, symbols] of this._definitions.entries()) {
      const filtered = symbols.filter(symbol => symbol.uri !== uri);
      if (filtered.length === 0) {
        this._definitions.delete(name);
      } else {
        this._definitions.set(name, filtered);
      }
    }
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
 * @local
 *
 * @summary The cache for all of the analyzed documents in the server.
 *
 * @see {@link analyzer.cache} the globally accessible location of this class
 * inside our analyzer instance
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
    const doc = this._documents.get(uri);
    if (doc) {
      doc.ensureParsed();
      return doc.documentSymbols;
    }
    return [];
  }
  getFlatDocumentSymbols(uri: URI): FishSymbol[] {
    return flattenNested<FishSymbol>(...this.getDocumentSymbols(uri));
  }
  getCommands(uri: URI): SyntaxNode[] {
    const doc = this._documents.get(uri);
    if (doc) {
      doc.ensureParsed();
      return doc.commandNodes;
    }
    return [];
  }
  getRootNode(uri: URI): Parser.SyntaxNode | undefined {
    return this.getParsedTree(uri)?.rootNode;
  }
  getParsedTree(uri: URI): Parser.Tree | undefined {
    const doc = this._documents.get(uri);
    if (doc) {
      doc.ensureParsed();
      return doc.tree;
    }
    return undefined;
  }
  getSymbolTree(uri: URI): FishSymbol[] {
    const analyzedDoc = this._documents.get(uri);
    if (!analyzedDoc) {
      return [];
    }
    analyzedDoc.ensureParsed();
    return analyzedDoc.documentSymbols;
  }
  getSources(uri: URI): Set<string> {
    const analyzedDoc = this._documents.get(uri);
    if (!analyzedDoc) {
      return new Set();
    }
    analyzedDoc.ensureParsed();
    const result: Set<string> = new Set();

    // Get the base directory for resolving relative paths
    const fromPath = uriToPath(uri);
    const baseDir = dirname(fromPath);

    const sourceNodes = analyzedDoc.sourceNodes.map((node: any) => getExpandedSourcedFilenameNode(node, baseDir)).filter((s: any) => !!s) as string[];
    for (const source of sourceNodes) {
      const sourceUri = pathToUri(source);
      result.add(sourceUri);
    }
    return result;
  }
  getSourceNodes(uri: URI): SyntaxNode[] {
    const analyzedDoc = this._documents.get(uri);
    if (!analyzedDoc) {
      return [];
    }
    analyzedDoc.ensureParsed();
    return analyzedDoc.sourceNodes;
  }
  clear(uri: URI) {
    this._documents.delete(uri);
  }
}
