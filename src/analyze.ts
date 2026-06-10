import * as LSP from 'vscode-languageserver';
import { DocumentUri, Hover, Location, Position, SymbolKind, URI, WorkDoneProgressReporter, WorkspaceSymbol } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import * as Locations from './utils/locations';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { dirname } from 'path';
import { config } from './config';
import { documents, LspDocument } from './document';
import { logger } from './logger';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol, processCompletion } from './parsing/complete';
import { FishSymbolCaches } from './parsing/fish-symbol-caches';
import { FishReferenceCandidate, FishReferenceCandidateCache, findReferenceSymbolType, isPotentialReferenceNode, ReferenceSymbolType, symbolReferenceType } from './parsing/reference-candidates';
import { createSourceResources, getExpandedSourcedFilenameNode, isSourceCommandArgumentName, isSourceCommandWithArgument, symbolsFromResource } from './parsing/source';
import { filterFirstPerScopeSymbol, FishSymbol, processNestedTree, SKIPPABLE_VARIABLE_REFERENCE_NAMES } from './parsing/symbol';
import { isSetVariableDefinitionName } from './parsing/set';
import { guardedSetQueryReference } from './parsing/reference-comparator';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { execCommandLocations } from './utils/exec';
import { SyncFileHelper } from './utils/file-operations';
import { flattenNested, iterateNested } from './utils/flatten';
import { findParentCommand, findParentFunction, getCommandNameNode, getCommandNameText, isAliasDefinitionName, isCommand, isCommandName, isCommandWithName, isOption, isTopLevelDefinition, isExportVariableDefinitionName, isVariable, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName, isDefinitionName } from './utils/node-types';
import { getNestedCommandReferenceAtPoint, isPossibleNested } from './utils/nested-command-point';
import { pathToUri, symbolKindToString, uriToPath } from './utils/translation';
import { containsRange, getChildNodes, getNamedChildNodes, getRange, isPositionAfter, isPositionWithinRange, namedNodesGen, nodesGen, precedesRange } from './utils/tree-sitter';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { initializeParser } from './parser';
import { BufferedAsyncDiagnosticCache } from './diagnostics/buffered-async-cache';
import { env } from 'src/utils/env-manager';
import { buildScopeSpans, isNodeExcluded, ScopeSpan } from './utils/skippable-scopes';

/*************************************************************/
/*     ts-doc type imports for links to other files here     */
/*************************************************************/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { FishServer } from './server'; // @ts-ignore
import { captureNameAtPosition } from './parsing/string-regex';
import { getImplementationLocations } from './implementation';

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
   * @param flatSymbols A flat array of FishSymbols, representing all symbols in the document.
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
     * A flat array of FishSymbols, representing all symbols in the document.
     */
    public flatSymbols: FishSymbol[] = [],

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
    flatSymbols: FishSymbol[] = [],
    tree: Parser.Tree | undefined = undefined,
    root: Parser.SyntaxNode | undefined = undefined,
    commandNodes: SyntaxNode[] = [],
    sourceNodes: SyntaxNode[] = [],
  ): AnalyzedDocument {
    return new AnalyzedDocument(
      document,
      documentSymbols,
      flatSymbols,
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
      if (isSourceCommandWithArgument(node)) {
        // Use the `argument` field so this still works when the command has
        // `override_variable` prefixes (post tree-sitter-fish PR #41).
        const arg = node.childrenForFieldName('argument')[0];
        if (arg) sourceNodes.push(arg);
      }
      commandNodes.push(node);
    });
    return new AnalyzedDocument(
      document,
      documentSymbols,
      flattenNested(...documentSymbols),
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

  public ensureParsed(): EnsuredAnalyzeDocument {
    if (this.isPartial()) {
      const fullDocument = analyzer.analyze(this.document);
      // Update this instance's properties in-place
      this.documentSymbols = fullDocument.documentSymbols;
      this.flatSymbols = fullDocument.flatSymbols;
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
   * Grouped FishSymbol indexes used across definition, reference, rename, and
   * diagnostic features.
   */
  public symbols: FishSymbolCaches = new FishSymbolCaches();
  public referenceCandidates: FishReferenceCandidateCache = new FishReferenceCandidateCache();

  /** in-flight handle for the background reference-candidate warm-up (see `warmReferenceCandidates`) */
  private referenceWarmHandle?: { cancelled: boolean; };

  public started = false;

  public diagnostics: BufferedAsyncDiagnosticCache = new BufferedAsyncDiagnosticCache();

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
    this.symbols.refreshDocument(
      document.uri,
      iterateNested(...analyzedDocument.documentSymbols),
    );
    this.referenceCandidates.removeByUri(document.uri);
    // Reference-candidate indexing is intentionally NOT done here. Doing it on
    // every `analyze()` call put a full-workspace tree walk on the startup hot
    // path (~2.5s of background analysis). Instead it is warmed off the critical
    // path via `warmReferenceCandidates()` after `onInitialized()`, and filled
    // on demand by `ensureReferenceCandidatesForUri()` for anything not yet
    // warmed or freshly edited (see `getReferences`).
    return analyzedDocument;
  }

  /**
   * Remove all global symbols for a document (used when document is closed or deleted)
   */
  public removeDocumentSymbols(uri: string): void {
    this.symbols.removeByUri(uri);
    this.referenceCandidates.removeByUri(uri);
    this.cache.clear(uri);
  }

  public isAutoloadedHelperFunction(symbol: FishSymbol): boolean {
    return this.symbols.isAutoloadedHelperFunction(symbol);
  }

  /**
   * @param uri the DocumentUri of the document that needs resolution
   * @returns AnalyzedDocument {@link @AnalyzedDocument} or undefined if the file could not be found.
   */
  public analyzeUri(uri: DocumentUri): AnalyzedDocument | undefined {
    const document = documents.get(uri) || SyncFileHelper.loadDocumentSync(uriToPath(uri));
    if (!document) {
      logger.warning(`analyzer.analyzePath: ${uri} not found`);
      return undefined;
    }
    return this.analyze(document);
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

  // Completion files are stored as partial AnalyzedDocuments (no tree),
  // which means their `complete -l flag` nodes aren't in the reference
  // candidate cache. Promote them on demand here so getReferences() can
  // surface argparse cross-file flag matches.
  private ensureReferenceCandidatesForUri(uri: DocumentUri): void {
    if (this.referenceCandidates.hasIndexed(uri)) return;
    const analyzed = this.cache.getDocument(uri);
    if (!analyzed) {
      this.analyzeUri(uri);
      return;
    }
    if (analyzed.isPartial()) analyzed.ensureParsed();
    if (analyzed.root) {
      this.referenceCandidates.ensureDocument(analyzed.document, analyzed.root);
    }
  }

  /**
   * Build the reference-candidate index for already-analyzed documents off the
   * critical path, a few documents per event-loop tick so incoming LSP requests
   * stay responsive. This is a pure relocation of the work that used to run
   * eagerly inside `analyze()`: only fully-analyzed documents are indexed here
   * (partial completion documents stay lazy, exactly as before). Idempotent with
   * the on-demand `ensureReferenceCandidatesForUri()` path via `hasIndexed()`.
   *
   * @returns a handle whose `cancel()` stops any further chunks (call on shutdown
   *          or when the workspace changes).
   */
  public warmReferenceCandidates(
    uris: DocumentUri[],
    opts: { chunkSize?: number; onProgress?: (done: number, total: number) => void; } = {},
  ): { cancel: () => void; } {
    // supersede any in-flight warm-up so we never run two at once
    if (this.referenceWarmHandle) this.referenceWarmHandle.cancelled = true;
    const handle = { cancelled: false };
    this.referenceWarmHandle = handle;

    const chunkSize = opts.chunkSize ?? 20;
    let i = 0;

    const step = () => {
      if (handle.cancelled) return;
      const end = Math.min(i + chunkSize, uris.length);
      for (; i < end; i++) {
        const uri = uris[i]!;
        if (this.referenceCandidates.hasIndexed(uri)) continue;
        const analyzed = this.cache.getDocument(uri);
        // Leave partial (completion) documents lazy; only warm full documents.
        if (!analyzed || analyzed.isPartial() || !analyzed.root) continue;
        this.referenceCandidates.ensureDocument(analyzed.document, analyzed.root);
      }
      opts.onProgress?.(i, uris.length);
      if (i < uris.length) setImmediate(step);
    };

    if (uris.length) setImmediate(step);
    return { cancel: () => {
      handle.cancelled = true;
    } };
  }

  /** Stop any in-flight background reference-candidate warm-up. */
  public cancelReferenceWarm(): void {
    if (this.referenceWarmHandle) this.referenceWarmHandle.cancelled = true;
  }

  // Prebuilt variables (PATH, HOME, status, $argv, …) don't have workspace
  // definitions, so `getDefinition` returns null for them. This walks the
  // workspace and matches by name + scope, the same way symbol-based search
  // would for a normal variable.
  private getPrebuiltVariableReferences(
    document: LspDocument,
    position: Position,
  ): Location[] {
    const context = this.getPrebuiltVariableReferenceContext(document, position);
    if (!context) return [];
    const { varName, documentsToSearch } = context;
    const results: Location[] = [];
    for (const doc of documentsToSearch) {
      results.push(...this.collectPrebuiltVariableReferenceLocations(doc, varName));
    }
    return results;
  }

  private getPrebuiltVariableReferenceContext(
    document: LspDocument,
    position: Position,
  ): { varName: string; documentsToSearch: LspDocument[]; } | null {
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!node) return null;

    const varName = isVariableExpansion(node) ? node.text.slice(1)
      : isVariableDefinitionName(node) || isSetVariableDefinitionName(node, false) ? node.text
        : isVariable(node) && node.type === 'variable_name' ? node.text
          : null;
    if (!varName) return null;

    // `getByName` returns an array (empty when the name isn't a documented
    // prebuilt like PATH/HOME/status). An empty array is truthy, so a plain
    // `a || b` / `!prebuilt` guard never rejects — which would route every
    // *undefined* variable (e.g. an out-of-scope `set --show args`) into this
    // scope-agnostic name-match fallback. Guard on length instead.
    //
    // `argv`/`fish_trace` are implicitly defined in every fish scope and have
    // no FishSymbol definition, so they always belong here — recognize them
    // directly rather than depend on the documentation map being populated
    // (it can be empty for these under some module-init orders).
    const prebuiltByDollar = PrebuiltDocumentationMap.getByName('$' + varName);
    const prebuilt = prebuiltByDollar.length ? prebuiltByDollar : PrebuiltDocumentationMap.getByName(varName);
    const isImplicitFishVariable = SKIPPABLE_VARIABLE_REFERENCE_NAMES.includes(varName);
    if (prebuilt.length === 0 && !isImplicitFishVariable) return null;

    const currentWorkspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
    if (!currentWorkspace) return null;

    return {
      varName,
      documentsToSearch: currentWorkspace.allDocuments(),
    };
  }

  private collectPrebuiltVariableReferenceLocations(
    doc: LspDocument,
    varName: string,
  ): Location[] {
    this.ensureReferenceCandidatesForUri(doc.uri);
    const scopeSpans = this.getScopeSpans(doc, varName);
    const candidates = this.referenceCandidates.findInDocument(doc.uri, varName);
    const locations: Location[] = [];

    for (const { node } of candidates) {
      // skip nodes inside local redefinitions, but allow self-referencing
      // expansions (e.g. $PATH in `set -lx PATH $PATH:/opt/bin`) since those
      // read the pre-existing global value before the local is created
      if (scopeSpans.length > 0 && isNodeExcluded(node, scopeSpans)) {
        continue;
      }
      if (isVariableExpansionWithName(node, varName)) {
        const focusedNode = node.firstNamedChild;
        if (!focusedNode || focusedNode.text !== varName) continue;
        locations.push(Location.create(doc.uri, getRange(focusedNode)));
      } else if (isVariableDefinitionName(node) && node.text === varName) {
        locations.push(Location.create(doc.uri, getRange(node)));
      } else if (!isVariableDefinitionName(node) && isSetVariableDefinitionName(node, false) && node.text === varName) {
        locations.push(Location.create(doc.uri, getRange(node)));
      }
    }

    return locations;
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
    const tree = this.parseDocument(document);
    const documentSymbols = this.processDocumentSymbols(document, tree.rootNode);
    return this.createFullDocument(document, documentSymbols, tree);
  }

  private parseDocument(document: LspDocument): Tree {
    return this.parser.parse(document.getText());
  }

  private processDocumentSymbols(document: LspDocument, rootNode: SyntaxNode): FishSymbol[] {
    return processNestedTree(document, rootNode);
  }

  private createFullDocument(
    document: LspDocument,
    documentSymbols: FishSymbol[],
    tree: Tree,
  ): AnalyzedDocument {
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
    const UPDATE_DELAY = currentDocuments.length > 100 ? 5 : 25; // Shorter delay for large sets

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
   * Resolve the FishSymbol referenced by a Location.
   *
   * Unlike getSymbolAtLocation(), this is intended for arbitrary reference
   * locations returned by getReferences(), not only definition locations that
   * already match a symbol's selectionRange.
   */
  public getSymbolFromReferenceLocation(location: Location): FishSymbol | null {
    const document = this.getDocument(location.uri);
    if (!document) return null;
    return this.getDefinition(document, location.range.start);
  }

  /**
   * Return the first FishSymbol seen that could be defined by the given position.
   */
  public findDocumentSymbol(
    document: LspDocument,
    position: Position,
  ): FishSymbol | undefined {
    const symbols = this.cache.getFlatDocumentSymbols(document.uri);
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
    const symbols = this.cache.getFlatDocumentSymbols(document.uri);
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
    const workspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
    // Set to avoid duplicate symbols
    const symbolNames: Set<string> = new Set();
    // add the local symbols
    const symbols = this.cache.getFlatDocumentSymbols(document.uri)
      .filter((symbol) =>
        symbol.scope.containsPosition(position)
        && symbol.isWithinDefinitionLifetime(position, document.uri),
      );
    symbols.forEach((symbol) => symbolNames.add(symbol.name));
    // add the sourced symbols
    const sourcedUris = this.collectReachableSources(document.uri, position);
    for (const sourcedUri of Array.from(sourcedUris)) {
      const visibleSourcedSymbols = this.symbols.allDocumentGlobalOrRootSymbols(sourcedUri)
        .filter(s =>
          !symbolNames.has(s.name)
          && s.uri !== document.uri,
        );
      symbols.push(...visibleSourcedSymbols);
      visibleSourcedSymbols.forEach((symbol) => symbolNames.add(symbol.name));
    }
    // add the global symbols
    for (const globalSymbol of this.symbols.allWorkspaceGlobalSymbols(workspace)) {
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
    return this.symbols.allWorkspaceGlobalSymbols(workspace)
      .map((s) => s.toWorkspaceSymbol())
      .filter((symbol: WorkspaceSymbol) => {
        return symbol.name.startsWith(query);
      });
  }

  /**
   * Name-matched symbols at a position, filtered by the *node context* so a
   * candidate that merely shares the word's text but is the wrong kind for the
   * node is dropped. This replaces a bare `allSymbolsByName.find(word)`: a
   * variable definition is only a candidate when the node is an actual variable
   * usage (`$var` / `variable_name`, a variable definition name, or a
   * `set -q/-e/-S NAME` target), so a bare command argument like `theme` in
   * `fish_config theme` no longer matches a `set -g theme` definition. Non-
   * variable symbols (functions/aliases/events) keep their broad matching —
   * they are referenced by bare command names and inside string carriers
   * (alias/`complete` values), with `isReference` arbitrating downstream.
   */
  public findSymbolsForPosition(document: LspDocument, position: Position): FishSymbol[] {
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    if (!word) return [];
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    return this.symbols.allSymbolsByName.find(word)
      .filter(symbol => symbolMatchesNodeContext(symbol, node));
  }

  /**
   * Utility function to get the definitions of a symbol at a given position.
   */
  private getDefinitionHelper(document: LspDocument, position: Position): FishSymbol[] {
    const symbols: FishSymbol[] = [];
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!word || !node) return [];

    const namedSymbols = this.findSymbolsForPosition(document, position);
    const localNamedSymbols = this.symbols.findDocumentNamedSymbols(document.uri, word);

    // Resolve a definition only at positions that could plausibly reference a
    // symbol: a direct identifier node (variable / command name / declaration),
    // OR a verified reference to a word-matched symbol. The direct node-shape
    // checks must stay because the multi-stage resolution below (local →
    // sourced → global → indexed paths) recognizes cross-file/sourced references
    // that the scope-validating `isReference` deliberately does not. The
    // `isReference` arm additionally rescues references living inside
    // nested-command carriers (alias values, `complete -n`/`-a` strings), where
    // the node is a string rather than a bare command name. Other positions
    // (operators, plain strings, builtin commands with no matching symbol) fall
    // through to the man-page/command-doc hover.
    if (
      !isVariable(node) && !isCommandName(node) && !isDefinitionName(node)
      && !namedSymbols.some(s => s.isReference(document, node))
    ) {
      return [];
    }

    // First check local symbols. A symbol is "the definition" when either:
    //   (a) its selectionRange contains the cursor's node (the usual case — node
    //       is the name token itself), OR
    //   (b) the cursor position falls within the symbol's selectionRange (which
    //       handles symbols whose selectionRange is a *substring* of a larger
    //       node — e.g. `(?<name>...)` captures inside a regex pattern string).
    const localSymbol = localNamedSymbols.find((s) => {
      if (s.name !== word) return false;
      return containsRange(s.selectionRange, getRange(node))
        || isPositionWithinRange(position, s.selectionRange);
    });
    if (localSymbol) {
      // A `set _flag_*` after `argparse 'n/name=' -- $argv` is a write to the
      // same variable argparse defined — treat it as the argparse symbol so
      // rename/refs cover the full identifier (def + `--flag` call sites +
      // every `_flag_*` read).
      symbols.push(localSymbol.canonicalArgparseRedefinition());
    } else {
      const toAdd: FishSymbol[] = localNamedSymbols.filter((s) => {
        const variableBefore = s.kind === SymbolKind.Variable ? precedesRange(s.selectionRange, getRange(node)) : true;
        const inLifetime = s.isWithinDefinitionLifetime(position, document.uri);
        if (
          containsRange(getRange(s.scope.scopeNode), getRange(node))
          && variableBefore
          && inLifetime
        ) {
          return true;
        }
        // A guarding `set -q NAME` query can precede the definition it guards in
        // a conditional chain (`set -lq X || set -l X`), so the cursor falls
        // before the def's selectionRange and `variableBefore` rejects it.
        // Resolve through the same scope-aware guard used for reference matching.
        return guardedSetQueryReference(s, document, node) === true;
      });
      symbols.push(...toAdd.map(s => s.canonicalArgparseRedefinition()));
    }

    // If no local symbols found but we're inside a --no-scope-shadowing function,
    // resolve the variable from the caller's scope
    if (!symbols.length && node) {
      const parentFuncNode = findParentFunction(node);
      if (parentFuncNode) {
        const parentFuncName = parentFuncNode.childForFieldName('name')?.text;
        const parentFuncSymbol = parentFuncName
          ? this.symbols.findDocumentFunctions(document.uri, parentFuncName)
            .find(s => s.node.equals(parentFuncNode))
          : undefined;
        if (parentFuncSymbol?.isFunctionWithNoScopeShadowing()) {
          const caller = this.findCallerFunction(
            parentFuncSymbol,
            new Set([this.functionSymbolKey(parentFuncSymbol)]),
            document.uri,
          );
          if (caller) {
            // Compare parent by identity, not just by name: two functions
            // with the same name (e.g. an erased top-level `_foo` and a
            // nested `_foo`) would otherwise be indistinguishable here and
            // the first matching parent — typically the erased one — wins.
            const callerVar = this.symbols.findDocumentVariables(caller.uri, word).find(s =>
              !!s.parent && s.parent.equals(caller),
            );
            if (callerVar) {
              symbols.push(callerVar);
            }
          }
        }
      }
    }

    // If no local symbols found, check sourced symbols
    if (!symbols.length) {
      const sourcedUris = this.collectReachableSources(document.uri, position);
      const sourcedSymbols = namedSymbols.filter(s =>
        s.uri !== document.uri
        && sourcedUris.has(s.uri)
        && (s.isGlobal() || s.isRootLevel()),
      );
      symbols.push(...sourcedSymbols);
    }

    // Finally, check global symbols as fallback
    if (!symbols.length) {
      const workspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
      const globalSymbols = this.symbols.findWorkspaceGlobalSymbols(word, workspace)
        .filter(symbol =>
          symbol.isWithinDefinitionLifetime(position, document.uri),
        );
      symbols.push(...globalSymbols);

      // If no match in the active workspace and single-workspace support is disabled,
      // fall back to indexed paths across all configured fish workspaces.
      if (!symbols.length && !config.fish_lsp_single_workspace_support) {
        const indexedPaths = config.fish_lsp_all_indexed_paths
          .map(path => SyncFileHelper.expandEnvVars(path))
          .filter(Boolean);

        const indexedPathSymbols = this.symbols.findIndexedPathGlobalSymbols(word, indexedPaths)
          .filter(symbol => symbol.isWithinDefinitionLifetime(position, document.uri));

        symbols.push(...indexedPathSymbols);
      }
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
    logger.log({
      word,
      node: node ? `text: ${node.text}, type: ${node.type}, ${Locations.Range.logString(getRange(node))}` : null,
    });
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
      // Resolve `cmd --flag` to the argparse symbol that owns `--flag`. Match
      // when either the parent function is globally callable (autoloaded), or
      // the call site is in the same document as the function definition —
      // otherwise non-autoloaded scripts (e.g. `/tmp/foo.fish`) couldn't
      // navigate from a `greet --name` call to greet's `argparse n/name`.
      // Use `findParentCommand` rather than `node.parent` because tree-sitter
      // wraps `--flag="value"` in a `concatenation` node — so `node.parent`
      // would be that concatenation, not the enclosing `command`.
      const enclosingCommandName = getCommandNameText(findParentCommand(node));
      const flagText = node.text.includes('=')
        ? node.text.slice(0, node.text.indexOf('='))
        : node.text;
      const symbol = this.findSymbol((s) => {
        if (s.parent && s.fishKind === 'ARGPARSE') {
          return enclosingCommandName === s.parent?.name &&
            (s.parent.isGlobal() || s.parent.uri === document.uri) &&
            flagText === s.argparseFlag;
        }
        return false;
      });
      if (symbol) return symbol;
    }
    const result = symbols.pop() || null;
    // For variables inside --no-scope-shadowing functions, resolve to the root
    // definition in the caller chain
    if (result?.isVariable() && result.parent?.isFunctionWithNoScopeShadowing()) {
      return this.resolveNoScopeShadowingDefinition(result);
    }
    // For --inherit-variable symbols, resolve to the caller's definition
    if (result?.isInheritVariable()) {
      return this.resolveInheritVariableDefinition(result) || result;
    }
    // For variables inside a function that inherits this variable name,
    // resolve to the caller's definition (e.g., B has --inherit-variable VAR
    // and also `set VAR ...` — the true definition is in the caller)
    if (result?.isVariable() && result.parent?.hasInheritedVariable(result.name)) {
      // Find the --inherit-variable declaration symbol for this variable
      const inheritDecl = result.parent.children
        .find((c: FishSymbol) => c.name === result.name && c.isInheritVariable());
      if (inheritDecl) {
        return this.resolveInheritVariableDefinition(inheritDecl) || result;
      }
    }
    return result;
  }

  private functionSymbolKey(symbol: FishSymbol): string {
    return symbol.id;
  }

  /**
   * Returns the function symbol enclosing a syntax node in the given document.
   */
  public getEnclosingFunctionSymbol(uri: string, node: SyntaxNode): FishSymbol | null {
    const parentFuncNode = findParentFunction(node);
    if (!parentFuncNode) return null;

    const parentFuncName = parentFuncNode.childForFieldName('name')?.text;
    if (!parentFuncName) return null;

    return this.symbols.findDocumentFunctions(uri, parentFuncName)
      .find(s => s.node.equals(parentFuncNode)) || null;
  }

  /**
   * Determines whether a function symbol is callable from the provided caller context.
   *
   * Current behavior intentionally treats non-global functions as document-local.
   * Cross-file visibility for `source`-scoped locals is not modeled here.
   */
  public isFunctionVisibleFrom(callee: FishSymbol, caller?: FishSymbol | null, callerUri?: string): boolean {
    if (!callee.isFunction()) return false;
    if (callee.isGlobal()) return true;

    const effectiveUri = caller?.uri || callerUri;
    return !!effectiveUri && callee.uri === effectiveUri;
  }

  public getCallableNoScopeShadowingFunctions(name: string, caller?: FishSymbol | null, callerUri?: string): FishSymbol[] {
    return this.symbols.noScopeShadowing.find(name)
      .filter(symbol => this.isFunctionVisibleFrom(symbol, caller, callerUri));
  }

  public getCallableInheritingFunctions(varName: string, caller?: FishSymbol | null, callerUri?: string): FishSymbol[] {
    return this.symbols.inheritedVariables.find(varName)
      .filter(symbol => this.isFunctionVisibleFrom(symbol, caller, callerUri));
  }

  /**
   * For a variable inside a `--no-scope-shadowing` function, walk up the call
   * chain to find the root definition. Since `--no-scope-shadowing` functions
   * share their caller's scope, the "true" definition is in the topmost caller
   * that also defines the same variable.
   *
   * @param varSymbol - a variable symbol whose parent is a --no-scope-shadowing function
   * @returns the root definition symbol, or the input symbol if no caller chain exists
   */
  public resolveNoScopeShadowingDefinition(varSymbol: FishSymbol): FishSymbol {
    if (!varSymbol.isVariable() || !varSymbol.parent?.isFunctionWithNoScopeShadowing()) {
      return varSymbol;
    }

    let currentFunc = varSymbol.parent;
    let rootVar = varSymbol;
    const visited = new Set<string>();

    while (currentFunc) {
      visited.add(this.functionSymbolKey(currentFunc));

      // Find ANY function that calls currentFunc, preferring same-document
      const caller = this.findCallerFunction(currentFunc, visited, varSymbol.uri);
      if (!caller) break;

      // Check if the caller also defines the same variable. Compare parent
      // by identity rather than name so two functions sharing a name (e.g.
      // an erased top-level `_foo` and a nested `_foo`) don't collide on
      // their implicit `argv` children.
      const callerVar = this.symbols.findDocumentVariables(caller.uri, varSymbol.name).find(s =>
        !!s.parent && s.parent.equals(caller),
      );
      if (!callerVar) break;

      // Move up the chain
      rootVar = callerVar;

      // Only continue walking if the caller is also --no-scope-shadowing
      if (caller.isFunctionWithNoScopeShadowing()) {
        currentFunc = caller;
      } else {
        break;
      }
    }

    return rootVar;
  }

  /**
   * Search all workspace functions for one that calls the given function name
   * (i.e., contains a command node with that name in its body).
   * Prioritizes callers in the same document as the target function.
   */
  private findCallerFunction(targetFunc: FishSymbol, visited: Set<string>, preferUri?: string): FishSymbol | null {
    const workspaceFunctions = [...this.symbols.allFunctionSymbols()];
    if (preferUri) {
      workspaceFunctions.sort((a, b) => a.uri === preferUri ? -1 : b.uri === preferUri ? 1 : 0);
    }

    for (const callerFunc of workspaceFunctions) {
      if (visited.has(this.functionSymbolKey(callerFunc))) continue;
      if (!this.isFunctionVisibleFrom(targetFunc, callerFunc, callerFunc.uri)) continue;

      // Scan the caller's scope node for command calls matching funcName
      for (const node of nodesGen(callerFunc.scopeNode)) {
        if (isCommand(node) && getCommandNameText(node) === targetFunc.name) {
          return callerFunc;
        }
      }
    }

    return null;
  }

  /**
   * For a variable declared with `--inherit-variable`, find the original
   * definition in the calling function. Walks up the call chain: finds which
   * function calls the one containing this --inherit-variable, then looks
   * for the variable definition there.
   */
  public resolveInheritVariableDefinition(inheritSymbol: FishSymbol, visited: Set<string> = new Set()): FishSymbol | null {
    if (!inheritSymbol.isInheritVariable()) return null;
    const parentFunc = inheritSymbol.parent;
    if (!parentFunc) return null;
    const key = `${inheritSymbol.uri}:${inheritSymbol.selectionRange.start.line}:${inheritSymbol.selectionRange.start.character}:${parentFunc.name}:${inheritSymbol.name}`;
    if (visited.has(key)) return null;
    visited.add(key);

    // Search all workspace functions for one that calls parentFunc
    for (const sym of this.symbols.allFunctionSymbols()) {
      if (sym.uri === parentFunc.uri && sym.name === parentFunc.name) continue;
      if (!this.isFunctionVisibleFrom(parentFunc, sym, sym.uri)) continue;

      // Check if this function's body calls parentFunc
      let callsTarget = false;
      for (const node of nodesGen(sym.scopeNode)) {
        if (isCommand(node) && getCommandNameText(node) === parentFunc.name) {
          callsTarget = true;
          break;
        }
      }
      if (!callsTarget) continue;

      // Found a caller — look for the variable definition in it
      const callerVar = this.symbols.findDocumentVariables(sym.uri, inheritSymbol.name).find(s =>
        s.parent?.name === sym.name
        && !s.isInheritVariable(),
      );
      if (callerVar) {
        // If the caller's var is also an --inherit-variable, recurse up
        if (callerVar.isInheritVariable()) {
          return this.resolveInheritVariableDefinition(callerVar, visited) || callerVar;
        }
        // If the caller function also inherits this variable from its caller,
        // recurse through the caller's inherit declaration
        if (sym.hasInheritedVariable(inheritSymbol.name)) {
          const inheritDecl = sym.children
            .find((c: FishSymbol) => c.name === inheritSymbol.name && c.isInheritVariable());
          if (inheritDecl) {
            return this.resolveInheritVariableDefinition(inheritDecl, visited) || callerVar;
          }
        }
        return callerVar;
      }
    }

    // Fallback: check script-level (program root) callers — e.g., init.fish with
    // `set -g VAR 1` and `foo` at the top level (not inside any function)
    for (const uri of this.cache.uris()) {
      if (!this.isFunctionVisibleFrom(parentFunc, null, uri)) continue;
      const root = this.cache.getRootNode(uri);
      if (!root) continue;

      // Check if this document's root level calls parentFunc
      let callsTarget = false;
      for (const node of nodesGen(root)) {
        if (isCommand(node) && getCommandNameText(node) === parentFunc.name) {
          callsTarget = true;
          break;
        }
      }
      if (!callsTarget) continue;

      // Found a script-level caller — look for a root-level variable definition
      const rootVar = this.symbols.findDocumentVariables(uri, inheritSymbol.name).find(s =>
        !s.parent?.isFunction()
        && !s.isInheritVariable(),
      );
      if (rootVar) return rootVar;
    }

    return null;
  }

  /**
   * Get all the definition locations of a position that we can find
   */
  public getDefinitionLocation(document: LspDocument, position: Position): LSP.Location[] {
    // handle source argument definition location
    const node = this.nodeAtPoint(document.uri, position.line, position.character);

    // Check that the node (or its parent) is a `source` command argument.
    // Returning early here would break `source $file` where the argument is a
    // variable: the path won't resolve, so we'd return [] without ever asking
    // whether `$file` itself has a definition. Only short-circuit when the
    // source-path branch actually found a target.
    if (node && isSourceCommandArgumentName(node)) {
      const sourceLoc = this.getSourceDefinitionLocation(node, document);
      if (sourceLoc.length > 0) return sourceLoc;
    } else if (node && node.parent && isSourceCommandArgumentName(node.parent)) {
      const sourceLoc = this.getSourceDefinitionLocation(node.parent, document);
      if (sourceLoc.length > 0) return sourceLoc;
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

    // Match hover()'s symbol fallback so value tokens like `nvim` in
    // `set -gx EDITOR nvim` can jump to indexed global symbols even when the
    // token is not itself a direct definition/reference node. Context-filter
    // the candidates so a bare word does not jump to a same-named *variable*
    // (e.g. `theme` in `fish_config theme` → `set -g theme`): variables are
    // only referenced via `$var` / a definition name / a `set -q/-e/-S` target.
    const word = this.wordAtPoint(document.uri, position.line, position.character);
    if (word) {
      if (!config.fish_lsp_single_workspace_support) {
        const indexedPaths = config.fish_lsp_all_indexed_paths
          .map(path => SyncFileHelper.expandEnvVars(path))
          .filter(Boolean);
        const indexedPathSymbol = this.symbols.findIndexedPathGlobalSymbols(word, indexedPaths)
          .find(symbol => symbolMatchesNodeContext(symbol, node));
        if (indexedPathSymbol) {
          return [indexedPathSymbol.toLocation()];
        }
      } else {
        const workspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
        const workspaceSymbol = this.symbols.findWorkspaceGlobalSymbols(word, workspace)
          .find(symbol => symbolMatchesNodeContext(symbol, node));
        if (workspaceSymbol) {
          return [workspaceSymbol.toLocation()];
        }
      }
    }

    // allow execCommandLocations to provide location for command when no other
    // definition has been found. Previously, config.fish_lsp_single_workspace_support
    // was used to prevent this case from being hit but now we always allow it.
    const currentWorkspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
    if (currentWorkspace) {
      const node = this.nodeAtPoint(document.uri, position.line, position.character);
      if (node && isCommandName(node)) {
        const text = node.text.toString();
        const locations = findCommandLocations(text);
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
   * Cycles between three reference kinds — definition, completion, usage —
   * based on what the cursor is currently on:
   *
   *   - usage      → all definition locations (multiple for global symbols
   *                  defined in several places)
   *   - definition → completion locations; stays on the definition if none
   *                  exist (no-op move)
   *   - completion → usage locations; falls back to the definition if no
   *                  usages exist
   *
   * Event symbols (`emit foo` ↔ `function _ --on-event foo`) skip the cycle
   * and return ALL matching counterparts — every emit site from a hook, or
   * every hook from an emit.
   */
  public getImplementation(
    document: LspDocument,
    position: Position,
    _opts: { reporter?: WorkDoneProgressReporter; } = {},
  ): Location[] {
    const cursorNode = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!cursorNode) return [];
    const symbol = this.getDefinition(document, position);
    if (!symbol) return [];

    // Event symbols cycle between emit and --on-event handlers, returning ALL
    // matches (a single emit can fire multiple handlers).
    if (symbol.isEmittedEvent() || symbol.isEventHook()) {
      const matchOther = symbol.isEmittedEvent()
        ? (m: FishSymbol) => m.isEventHook()
        : (m: FishSymbol) => m.isEmittedEvent();
      const others = this.symbols.eventsByName.find(symbol.name).filter(matchOther);
      if (others.length > 0) return others.map(s => s.toLocation());
      return [symbol.toLocation()];
    }

    // --no-scope-shadowing function definition cycles to a call site (any
    // reference that isn't the definition itself). The plain cycle would stop
    // at the definition because no `complete -c` entry typically exists for
    // these helper functions, so we elevate "usage" before falling through.
    if (symbol.isFunction() && symbol.isFunctionWithNoScopeShadowing()) {
      const def = symbol.selectionRange.start;
      const callSites = this.getReferences(document, position, { localOnly: true })
        .filter(loc => loc.range.start.line !== def.line || loc.range.start.character !== def.character);
      if (callSites.length > 0) return callSites;
    }

    return getImplementationLocations(document, position);
  }

  /**
   * Cache-driven reference search. Resolves the symbol at `position`, scopes
   * the search to the containing workspace (unless `allWorkspaces`), and
   * iterates the precomputed reference-candidate cache rather than walking
   * each document's AST.
   */
  public getReferences(
    document: LspDocument,
    position: Position,
    opts: {
      includeDefinitions?: boolean;
      localOnly?: boolean;
      allWorkspaces?: boolean;
      reporter?: WorkDoneProgressReporter;
    } = {},
  ): Location[] {
    const includeDefinitions = opts.includeDefinitions ?? true;
    const foundSymbol = this.getDefinition(document, position);
    // Prebuilt vars (PATH, HOME, status, $argv, …) typically have no workspace
    // definition, so fall back to the dedicated prebuilt search only when the
    // symbol-based path can't resolve a definition.
    if (!foundSymbol) {
      return this.getPrebuiltVariableReferences(document, position);
    }

    // Scope candidates to the workspace that contains the searched document.
    // The reference-candidate cache spans every indexed file across every
    // workspace, so without this filter a `set foo` definition inside the
    // user's workspace would surface hits from fish-lsp's own bundled files
    // (or any other indexed workspace). When allWorkspaces is on, skip the
    // filter entirely.
    const searchWorkspace =
      workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
    const searchableUris = opts.allWorkspaces
      ? null
      : searchWorkspace?.allUris ?? null;

    // Ensure every document in scope is fully parsed and indexed in the
    // reference-candidate cache before lookup. Completion files are stored
    // as partial AnalyzedDocuments (see workspaceManager.analyzePendingDocuments),
    // so without this they wouldn't surface `complete -l flag` matches.
    if (opts.localOnly) {
      this.ensureReferenceCandidatesForUri(document.uri);
    } else if (searchableUris) {
      for (const uri of searchableUris) this.ensureReferenceCandidatesForUri(uri);
    }

    // Group cache hits by URI so we can apply per-document shadowing filters
    // without iterating workspace documents that have no matching candidates.
    const candidatesByUri = new Map<string, FishReferenceCandidate[]>();
    for (const candidate of this.referenceCandidates.findForSymbol(foundSymbol)) {
      if (opts.localOnly && candidate.uri !== document.uri) continue;
      if (!opts.localOnly && searchableUris && !searchableUris.has(candidate.uri)) continue;
      const bucket = candidatesByUri.get(candidate.uri);
      if (bucket) bucket.push(candidate);
      else candidatesByUri.set(candidate.uri, [candidate]);
    }

    const results: Location[] = [];
    const seen = new Set<string>();
    const locationKey = (loc: Location): string =>
      `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;
    const addLocation = (loc: Location): void => {
      const key = locationKey(loc);
      if (seen.has(key)) return;
      seen.add(key);
      results.push(loc);
    };

    if (includeDefinitions) addLocation(foundSymbol.toLocation());

    for (const [uri, candidates] of candidatesByUri) {
      const searchDoc = this.getDocument(uri);
      if (!searchDoc) continue;

      const shadowing = this.getShadowingLocalSymbols(foundSymbol, searchDoc);
      for (const candidate of candidates) {
        if (shadowing.some(s => {
          // A shadowing local only hides candidates within its own lifetime
          // window (from its definition until an in-scope `set -e`/`set -el`
          // erase). A reference *before* the local is defined — e.g. the
          // `$foo` in `echo $foo | read -l foo` — or *after* it is erased
          // still belongs to the outer/global definition. (The plain
          // `containsNode` check is line-based, so without this gate a same-
          // line pre-definition reference would be wrongly shadowed.)
          // `referenceWithinLifetime` keeps nested-function references (e.g.
          // an earlier-defined `--inherit-variable` callee) inside the window.
          if (!s.referenceWithinLifetime(candidate.node)) {
            return false;
          }
          return s.containsNode(candidate.node)
            || s.scopeNode.equals(candidate.node)
            || s.scopeContainsNode(candidate.node);
        })) continue;
        if (!foundSymbol.isReference(candidate.document, candidate.node, true)) continue;
        // toLocationsFor handles argparse dash-stripping and extracts inner
        // command positions out of alias/bind/complete-condition string nodes —
        // candidate.toLocation() would point at the option's bare range instead.
        for (const loc of candidate.toLocationsFor(foundSymbol)) {
          addLocation(loc);
        }
      }
    }

    return results.sort(FishReferenceCandidate.comparatorForSymbol(foundSymbol));
  }

  /**
   * Returns all local symbols in `doc` the analyzer cannot prove are used —
   * the underlying "unused local reference" report consumed by diagnostics.
   *
   * Two passes:
   *   1. First-pass name-matched scan via the per-doc reference-candidate
   *      cache, with shadowing-local filtering (same logic that drops
   *      `argparse h/help`'s own definition node from its own reference
   *      sweep). A symbol is "used" if any non-shadowed candidate passes
   *      `symbol.isReference(...)`.
   *   2. Rescue pass on the otherwise-unused set, dropping symbols that
   *      are indirectly referenced — argparse alias equivalence, root
   *      defs of --no-scope-shadowing variables, --inherit-variable
   *      callers, --no-scope-shadowing callees, and event-hook globals /
   *      autoload pairs.
   */
  public allUnusedLocalReferences(document: LspDocument): FishSymbol[] {
    // Reference candidates are no longer built eagerly during analysis (they are
    // warmed off the critical path / on demand), so ensure this document's
    // candidates exist before querying them below via findInDocumentForSymbol.
    this.ensureReferenceCandidatesForUri(document.uri);

    const symbols = filterFirstPerScopeSymbol(document).filter(s =>
      s.isLocal()
      && (s.needsLocalReferences() || s.isEmittedEvent())
      && !s.isEventHook()
      && !s.isExported(),
    );

    const usedSymbols: FishSymbol[] = [];
    const unusedSymbols: FishSymbol[] = [];

    for (const symbol of symbols) {
      const shadowing = this.getShadowingLocalSymbols(symbol, document);
      let found = false;
      for (const candidate of this.referenceCandidates.findInDocumentForSymbol(document.uri, symbol)) {
        const node = candidate.node;
        // isPotentialReferenceNode is stricter than the cache's broad index —
        // rejects e.g. `bar` in `set foo bar` from being treated as a ref to `bar`.
        if (!isPotentialReferenceNode(symbol, node)) continue;
        if (shadowing.some(s => s.scopeContainsNode(node))) continue;
        if (symbol.isReference(document, node, true)) {
          found = true;
          usedSymbols.push(symbol);
          break;
        }
      }
      if (!found) unusedSymbols.push(symbol);
    }

    return unusedSymbols.filter(symbol => {
      // A variable in a --no-scope-shadowing function may be backed by a
      // definition in the calling scope; treat references to the root as
      // usage of this local rebinding.
      if (this.isUsedViaNoScopeShadowingRoot(symbol)) return false;

      // argparse aliases: `argparse h/help`, `_flag_h`, `_flag_help`,
      // `complete -s h -l help`, `--help` all map to the same logical
      // flag — if any equivalent symbol was found used, this one is too.
      if (symbol.isArgparse() && usedSymbols.some(s => s.equalArgparse(symbol))) {
        return false;
      }

      // A local variable counts as used if a --no-scope-shadowing function
      // visible from the caller is invoked inside the variable's scope and
      // references the variable's name (either as a child symbol or as a
      // `$var` expansion in the function body).
      if (symbol.isVariable() && this.symbols.noScopeShadowing.allSymbols.length > 0) {
        const scopeNode = symbol.scope.scopeNode;
        if (scopeNode) {
          const noScopeFuncs = this.symbols.noScopeShadowing.allSymbols.filter(f => {
            if (!this.isFunctionVisibleFrom(f, symbol.parent, symbol.uri)) return false;
            if (f.children.some(c => c.isVariable() && c.name === symbol.name)) return true;
            for (const n of nodesGen(f.scopeNode)) {
              if (isVariableExpansionWithName(n, symbol.name)) return true;
            }
            return false;
          });
          if (noScopeFuncs.length > 0) {
            for (const n of nodesGen(scopeNode)) {
              if (isCommandWithName(n, ...noScopeFuncs.map(f => f.name))) {
                return false;
              }
            }
          }
        }
      }

      // --inherit-variable: a local var counts as used if a function that
      // inherits it via `--inherit-variable name` is called inside the var's
      // scope.
      if (symbol.isVariable() && this.symbols.inheritedVariables.has(symbol.name)) {
        const inheritingFuncs = this.getCallableInheritingFunctions(symbol.name, symbol.parent, symbol.uri);
        const scopeNode = symbol.scope.scopeNode;
        if (scopeNode) {
          for (const n of nodesGen(scopeNode)) {
            if (isCommandWithName(n, ...inheritingFuncs.map(f => f.name))) {
              return false;
            }
          }
        }
      }

      // Event hooks: global functions with --on-event are conservatively kept;
      // local hooks are kept when there's a matching emit either inside the
      // same symbol's children (locally emitted) or anywhere in the workspace
      // for autoloaded functions.
      if (symbol.hasEventHook()) {
        if (symbol.isGlobal()) return false;
        if (
          symbol.isLocal()
          && symbol.children.some(c => c.fishKind === 'FUNCTION_EVENT' && usedSymbols.some(s => s.isEmittedEvent() && c.name === s.name))
        ) {
          return false;
        }
        if (symbol.document.isAutoloaded() && symbol.isFunction()) {
          for (const event of symbol.children.filter(c => c.isEventHook())) {
            if (this.symbols.eventsByName.find(event.name).some(m => m.isEmittedEvent())) {
              return false;
            }
          }
        }
      }
      return true;
    });
  }

  /**
   * A variable inside a --no-scope-shadowing function shares the calling
   * scope's namespace, so a write to it is "used" when the caller has a
   * defining reference to the same name. Returns true if the root symbol
   * (resolved via [[resolveNoScopeShadowingDefinition]]) has any ref other
   * than its own definition.
   */
  private isUsedViaNoScopeShadowingRoot(symbol: FishSymbol): boolean {
    if (!symbol.isVariable() || !symbol.parent?.isFunctionWithNoScopeShadowing()) {
      return false;
    }
    const rootSymbol = this.resolveNoScopeShadowingDefinition(symbol);
    const rootRefs = this.getReferences(rootSymbol.document, rootSymbol.selectionRange.start);
    return rootRefs.some(loc =>
      loc.uri !== rootSymbol.uri
      || loc.range.start.line !== rootSymbol.selectionRange.start.line
      || loc.range.start.character !== rootSymbol.selectionRange.start.character,
    );
  }

  /**
   * Local symbols in `doc` that shadow `definitionSymbol` — references whose node
   * falls inside any of these symbols' scopes should be excluded when collecting
   * references for `definitionSymbol`.
   */
  private getShadowingLocalSymbols(definitionSymbol: FishSymbol, doc: LspDocument): FishSymbol[] {
    if (definitionSymbol.isVariable() && !definitionSymbol.isArgparse()) {
      return this.symbols.findDocumentVariables(doc.uri, definitionSymbol.name).filter(s =>
        s.isLocal()
        && !s.equals(definitionSymbol)
        && !definitionSymbol.equalScopes(s)
        && s.name === definitionSymbol.name
        && s.kind === definitionSymbol.kind
        && !s.parent?.isFunctionWithNoScopeShadowing()
        && !s.isInheritVariable(),
      );
    }
    if (doc.uri === definitionSymbol.uri) return [];
    return this.symbols.findDocumentNamedSymbols(doc.uri, definitionSymbol.name).filter(s =>
      s.isLocal()
      && s.kind === definitionSymbol.kind
      && !s.equals(definitionSymbol),
    );
  }

  /**
   * Gets the location of the sourced file for the given source command argument name node.
   */
  private getSourceDefinitionLocation(node: SyntaxNode, document: LspDocument): LSP.Location[] {
    if (node && isSourceCommandArgumentName(node)) {
      // Get the base directory for resolving relative paths
      const fromPath = uriToPath(document.uri);
      const baseDir = dirname(fromPath);

      const expanded = getExpandedSourcedFilenameNode(node, baseDir);
      // `source $file` (and other non-literal arguments) can't be expanded to
      // a real path — bail so the caller can fall back to symbol resolution.
      if (!expanded) return [];
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
  /**
   * Whether `symbol`'s hover should be shown at `node`. A symbol's hover applies
   * at its own declaration, or at a genuine reference whose *category* matches —
   * a `$var` node never shows a function's hover, a bare command name never
   * shows a variable's. `nodeType === null` (an ambiguous carrier) keeps the
   * looser reference-only check, with `isReference` arbitrating.
   */
  private symbolHoverApplies(
    symbol: FishSymbol,
    document: LspDocument,
    node: SyntaxNode,
    nodeType: ReferenceSymbolType | null,
  ): boolean {
    if (isDefinitionName(node)) return true;
    if (!symbol.isReference(document, node)) return false;
    return nodeType === null || symbolReferenceType(symbol) === nodeType;
  }

  /**
   * Classifier-driven hover resolution.
   *
   *   1. Classify the node (`findReferenceSymbolType`) so candidate symbols of
   *      the wrong category are never considered.
   *   2. Prefer the resolved definition — `getDefinition` understands cross-file,
   *      sourced, alias and argparse-option references the pure classifier can't.
   *   3. Otherwise fall back to a name-matched global symbol *of the same
   *      category* (e.g. an autoloaded function referenced before its own file
   *      is indexed).
   *
   * Returns `null` when nothing resolves, so `onHover` falls back to prebuilt /
   * man-page / parent-command documentation.
   */
  public getHover(document: LspDocument, position: Position): Hover | null {
    const tree = this.getTree(document.uri);
    const node = this.nodeAtPoint(document.uri, position.line, position.character);

    if (!tree || !node) return null;

    const nodeType = findReferenceSymbolType(node);

    // Candidates, most-precise first: the resolved definition (understands
    // cross-file / sourced / argparse-option references), then every same-name
    // symbol whose category matches the node context. The category filter is
    // what lets a `cmd` *call* skip a same-named `set` variable and find the
    // function, and a `$cmd` skip the function and find the variable.
    const definition = this.getDefinition(document, position);
    const candidates = definition
      ? [definition, ...this.findSymbolsForPosition(document, position)]
      : this.findSymbolsForPosition(document, position);
    for (const symbol of candidates) {
      if (this.symbolHoverApplies(symbol, document, node, nodeType)) {
        logger.log(`analyzer.getHover: ${symbol.name}`, {
          name: symbol.name,
          uri: symbol.uri,
          kind: symbolKindToString(symbol.kind),
          nodeType,
        });
        return symbol.toHover();
      }
    }

    // No locally-resolved symbol — try a same-category global (e.g. an
    // autoloaded function referenced before its own file is indexed).
    if (nodeType !== null) {
      const globalMatch = this.symbols.globalSymbols.find(node.text)
        .find(s => symbolReferenceType(s) === nodeType
          && this.symbolHoverApplies(s, document, node, nodeType));
      if (globalMatch) return globalMatch.toHover();
    }
    return null;
  }

  /**
   * Data for a name that is *referenced but never defined* — a function called
   * or a variable expanded multiple times with no matching definition anywhere
   * in the indexed workspace. Powers the last-resort "multi-reference" hover
   * (built in `hover.ts`) shown only when no symbol, prebuilt, or command/man
   * documentation applies.
   *
   * Returns `null` unless: the node has a definite category, there is no
   * definition of that name+category, and there are at least two distinct
   * reference sites of the matching category in this document.
   */
  public getUndefinedReferenceSites(
    document: LspDocument,
    position: Position,
  ): { name: string; category: ReferenceSymbolType; sites: { line: number; snippet: string; }[]; } | null {
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
    if (!node) return null;
    const category = findReferenceSymbolType(node);
    if (category === null) return null;
    const name = this.wordAtPoint(document.uri, position.line, position.character)?.trim() || node.text;
    if (!name) return null;

    // A definition of this name+category exists → `getHover` already shows it.
    const hasDefinition = this.symbols.allSymbolsByName.find(name)
      .some(s => symbolReferenceType(s) === category);
    if (hasDefinition) return null;

    this.ensureReferenceCandidatesForUri(document.uri);
    // A single `$var` reference yields overlapping candidate nodes (the
    // `variable_expansion` and its inner `variable_name`); merge them so each
    // logical use counts once. Sort by position, then drop any candidate that
    // starts inside the previously-kept candidate's range.
    const candidates = this.referenceCandidates.findInDocument(document.uri, name)
      .filter(candidate => findReferenceSymbolType(candidate.node) === category)
      .sort((a, b) =>
        a.range.start.line - b.range.start.line
        || a.range.start.character - b.range.start.character);

    const sites: { line: number; snippet: string; }[] = [];
    let lastEnd: Position | null = null;
    for (const candidate of candidates) {
      const start = candidate.range.start;
      if (lastEnd && (start.line < lastEnd.line
        || start.line === lastEnd.line && start.character < lastEnd.character)) {
        continue;
      }
      const enclosing = findParentCommand(candidate.node) ?? candidate.node;
      sites.push({ line: start.line, snippet: enclosing.text.split('\n')[0]!.trim() });
      lastEnd = candidate.range.end;
    }
    if (sites.length < 2) return null;
    return { name, category, sites };
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
   * Computes scope spans for a variable `name` within a document.
   * Returns sorted, non-overlapping ScopeSpan segments covering the document,
   * each tagged as 'include' or 'exclude' for reference searching.
   *
   * When a local variable shadows a global/outer definition of the same name,
   * the local's scope becomes an 'exclude' span. Self-referencing expansions
   * (e.g. `$PATH` in `set -lx PATH $PATH:/opt/bin`) punch 'include' holes.
   */
  getScopeSpans(doc: LspDocument, name: string): ScopeSpan[] {
    const root = this.getRootNode(doc.uri);
    if (!root) return [];
    const variableSymbols = this.symbols.findDocumentVariables(doc.uri, name);
    return buildScopeSpans(root, variableSymbols);
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

      const topLevelDefinitions = this.symbols.allDocumentGlobalOrRootSymbols(sourceDoc.uri);
      for (const symbol of topLevelDefinitions) {
        if (!uniqueNames.has(symbol.name)) {
          uniqueNames.add(symbol.name);
          sourcedSymbols.push(symbol);
        }
      }

      for (const resource of createSourceResources(analyzer, sourceDoc)) {
        // If the resource is a sourced file, we can get its symbols
        if (resource.to && resource.from && resource.node) {
          const symbols = symbolsFromResource(this, resource, uniqueNames)
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
   * Collects all reachable symbols for a document:
   * - local defined symbols inside the document itself
   * - all sourced symbols from reachable source files
   *
   * @param documentUri - the uri of the document to collect symbols for
   * @returns {FishSymbol[]} - array of all reachable symbols
   */
  public allReachableSymbols(documentUri: string): FishSymbol[] {
    const seenSymbols = this.getFlatDocumentSymbols(documentUri);
    analyzer.collectAllSources(documentUri).forEach((s) => {
      analyzer.analyzeUri(s);
      this.symbols.allDocumentGlobalOrRootSymbols(s)
        .filter(symbol => symbol.name !== 'argv')
        .forEach(sym => {
          seenSymbols.push(sym);
        });
    });
    return seenSymbols;
  }

  /**
   * Collects all reachable function symbols for a document.
   *
   * This is the function-only counterpart to `allReachableSymbols()`, which
   * avoids repeatedly scanning mixed symbol lists when only callable names are
   * needed.
   */
  public allReachableFunctions(documentUri: string): FishSymbol[] {
    const seenFunctions = this.symbols.allDocumentFunctions(documentUri);

    analyzer.collectAllSources(documentUri).forEach((s) => {
      analyzer.analyzeUri(s);
      this.symbols.allDocumentGlobalOrRootSymbols(s)
        .filter(symbol => symbol.isFunction())
        .forEach(symbol => {
          seenFunctions.push(symbol);
        });
    });

    return seenFunctions;
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

    if (!node) return null;

    // Handle definition-name nodes like `alias foo='bar'` before nested-command
    // extraction so the cursor on `foo` keeps resolving to the alias symbol.
    // For the bare-word form `alias foo=ref_cmd` (tree-sitter keeps it as a
    // single `word` node) the cursor position decides which half is returned:
    // before/on `=` → the alias name, after `=` → the value command.
    if (isAliasDefinitionName(node) || isExportVariableDefinitionName(node)) {
      const text = node.text;
      const eqIdx = text.indexOf('=');
      if (eqIdx < 0) return text.trim() || null;
      const colInNode = node.startPosition.row === line
        ? column - node.startPosition.column
        : -1;
      if (colInNode > eqIdx) {
        return text.slice(eqIdx + 1).trim() || null;
      }
      return text.slice(0, eqIdx).trim() || null;
    }

    // Keep direct variable tokens authoritative so `$var` inside `(math $var + 1)`
    // resolves as `var` instead of collapsing to the nested command `math`.
    if (isVariableExpansion(node)) {
      return node.text.trim().replace(/^\$/, '');
    }
    if (node.type === 'variable_name' && node.parent && isVariableExpansion(node.parent)) {
      return node.text.trim();
    }

    // If the cursor is on an AST-parsed command name (e.g. `no_color` in
    // `(_fish_alt_greeting | no_color)`), trust the node directly.
    // The nested-command path walks up to the enclosing `(...)` carrier and
    // always returns the *first* command in the substitution, not the one
    // under the cursor.
    if (isCommandName(node)) {
      return node.text.trim();
    }

    // Cursor inside `(?<name>…)` of a `string -r` regex pattern. Tree-sitter
    // keeps the pattern as a single opaque string node, so without this hook
    // wordAtPoint would fall through to `return null` and the hover handler
    // would drop into its parent-command man-page fallback (showing the
    // `string` man page instead of the capture symbol's hover).
    const capName = captureNameAtPosition(node, { line, character: column });
    if (capName) return capName;

    if (isPossibleNested(node)) {
      const nestedCommand = getNestedCommandReferenceAtPoint(uri, { line, character: column }, node);
      if (nestedCommand) return nestedCommand.command;
    }

    if (node.childCount > 0 || node.text.trim() === '') {
      return null;
    }

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

    const nameNode = getCommandNameNode(node);
    if (!nameNode || !isCommandName(nameNode)) return null;

    return nameNode.text.trim();
  }

  public commandAtPoint(
    uri: string,
    line: number,
    column: number,
  ): SyntaxNode | null {
    if (!this.cache.getRootNode(uri)) return null;
    const node = this.nodeAtPoint(uri, line, column) ?? undefined;
    if (node && isCommand(node)) return node;
    if (node && isPossibleNested(node)) {
      const nestedCommand = getNestedCommandReferenceAtPoint(uri, { line, character: column }, node);
      if (nestedCommand) {
        const commandNode = this.nodeAtPoint(uri, nestedCommand.range.start.line, nestedCommand.range.start.character);
        if (commandNode) {
          return commandNode;
        }
      }
    }
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
    return this._documents.get(uri)?.flatSymbols || [];
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

/**
 * Decides whether a name-matched {@link FishSymbol} is a plausible candidate
 * for the syntax node at a request position (used by
 * {@link Analyzer.findSymbolsForPosition}).
 *
 * The only kind-sensitive rule is for variables: fish only references a
 * variable through a `$var` expansion / `variable_name`, a variable definition
 * name, or a `set -q/-e/-S NAME` target. A plain word — e.g. the `theme`
 * argument in `fish_config theme` — is therefore NOT a reference to a
 * `set -g theme` variable, even though the text matches. Every other symbol
 * kind (functions, aliases, events, …) keeps broad name matching, because they
 * are legitimately referenced by bare command names and inside string carriers
 * (`alias`/`complete` values); `isReference` validates those downstream.
 */
function symbolMatchesNodeContext(symbol: FishSymbol, node: SyntaxNode | null): boolean {
  if (!node) return true;
  const nodeType = findReferenceSymbolType(node);
  const symbolType = symbolReferenceType(symbol);
  // Variables must sit at an actual variable usage (`$var`, a definition name, a
  // `set -q/-e/-S` target) — never a carrier word/string. This keeps a bare
  // command argument (`theme` in `fish_config theme`) from resolving to a
  // same-named `set -g theme`.
  if (symbolType === 'variable') {
    return nodeType === 'variable';
  }
  // Functions/events are also referenced from inside string carriers
  // (alias/`complete`/`bind` values), which classify as `null`; only reject a
  // node whose context is unambiguously a *different* category. `isReference`
  // arbitrates the remaining cases downstream.
  return nodeType === null || nodeType === symbolType;
}

export function findCommandLocations(cmd: string) {
  const paths: { path: string; uri: DocumentUri; }[] = env.findAutoloadedFunctionPath(cmd).map(filePath => ({
    uri: pathToUri(filePath),
    path: filePath,
  }));
  if (paths.length === 0) {
    const potentialPaths = execCommandLocations(cmd).filter(p => {
      if (p.path.startsWith('embedded:')) return false;
      return SyncFileHelper.isFile(p.path);
    });
    paths.push(...potentialPaths);
  }
  return paths;
}
