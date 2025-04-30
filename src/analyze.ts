import { Hover, Position, SymbolKind, WorkspaceSymbol, URI, Location } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { isPositionWithinRange, getChildNodes, containsRange, getRange, precedesRange, isPositionAfter } from './utils/tree-sitter';
import { LspDocument, documents } from './document';
import { findParentFunction, isAliasDefinitionName, isCommand, isCommandName, isOption, isTopLevelDefinition } from './utils/node-types';
import { pathToUri, symbolKindToString, uriToPath } from './utils/translation';
import { existsSync } from 'fs';
import { currentWorkspace, Workspace, workspaces } from './utils/workspace';
import { config, getDefaultConfiguration, updateBasedOnSymbols } from './config';
import { logger } from './logger';
import { SyncFileHelper } from './utils/file-operations';
import { FishSymbol, processNestedTree } from './parsing/symbol';
import { flattenNested } from './utils/flatten';
import { isArgparseVariableDefinitionName } from './parsing/argparse';
import { getExpandedSourcedFilenameNode, isSourceCommandArgumentName } from './parsing/source';
import { CompletionSymbol, isCompletionDefinition, processCompletion } from './parsing/complete';
import { execCommandLocations } from './utils/exec';
import { implementationLocation } from './references';
import { hasWorkspaceFolderCapability } from './server';

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

export class Analyzer {
  protected parser: Parser;
  public cache: AnalyzedDocumentCache = new AnalyzedDocumentCache();
  public globalSymbols: GlobalDefinitionCache = new GlobalDefinitionCache();
  // public workspaceAnalyzed: Workspace | null = null;

  public amountIndexed: number = 0;

  constructor(parser: Parser) {
    this.parser = parser;
  }

  /**
   * Analyze an LspDocument and return an AnalyzedDocument.
   */
  public analyze(document: LspDocument): AnalyzedDocument {
    this.parser.reset();
    const analyzedDocument = this.getAnalyzedDocument(
      this.parser,
      document,
    );
    this.cache.setDocument(document.uri, analyzedDocument);
    const symbols = this.cache.getDocumentSymbols(document.uri);
    flattenNested(...symbols).filter(s => s.isGlobal()).forEach((symbol: FishSymbol) => {
      this.globalSymbols.add(symbol);
    });
    return analyzedDocument;
  }

  /**
   * Helper method to get the AnalyzedDocument.
   */
  private getAnalyzedDocument(
    parser: Parser,
    document: LspDocument,
  ): AnalyzedDocument {
    parser.reset();
    const tree = parser.parse(document.getText());
    const documentSymbols = processNestedTree(
      document,
      tree.rootNode,
    );
    const commands = this.getCommandNames(document.uri);
    // const sourcedUris = new Set<string>();
    const sourceNodes: SyntaxNode[] = [];
    getChildNodes(tree.rootNode)
      .filter(node => isSourceCommandArgumentName(node))
      .forEach(node => {
        if (isSourceCommandArgumentName(node)) {
          sourceNodes.push(node);
        }
      });

    return AnalyzedDocument.create(
      document,
      documentSymbols,
      commands,
      tree,
      sourceNodes,
      // sourcedUris,
    );
  }

  /**
   * Take a path to a file and analyze it, returning it's AnalyzedDocument.
   */
  public analyzePath(rawFilePath: string): AnalyzedDocument {
    const path = uriToPath(rawFilePath);
    const content = SyncFileHelper.read(path, 'utf-8');
    const document = LspDocument.createTextDocumentItem(pathToUri(path), content);
    return this.analyze(document);
  }

  /**
   * Take a path to a file and analyze it, returning it's AnalyzedDocument.
   * This is useful for when you are bulk analyzing files for a workspace, 
   * and don't want to block the event loop.
   */
  public async analyzePathAsync(
    rawFilePath: string,
  ): Promise<AnalyzedDocument> {
    const path = uriToPath(rawFilePath);
    const uri = pathToUri(path);
    const content = await fs.readFile(path, 'utf-8');
    const document = LspDocument.createTextDocumentItem(uri, content);
    return this.analyze(document);
  }

  updateConfigInWorkspace(
    documentUri: string,
  ) {
    const workspace = currentWorkspace.current;
    let symbols = this.getFlatDocumentSymbols(documentUri).filter(symbol => {
      return symbol.kind === SymbolKind.Variable && Object.keys(config).includes(symbol.name);
    });
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

  public async initiateBackgroundAnalysis(
    callbackfn: (text: string) => void,
    progress: LSP.WorkDoneProgressReporter,
  ): Promise<{ filesParsed: number; }> {
    const startTime = performance.now();
    const max_files = config.fish_lsp_max_background_files;
    let amount = 0;
    // if there isn't a workspace folder capability, we need to analyze all the workspaces
    // that are available.
    if (!hasWorkspaceFolderCapability || !config.fish_lsp_single_workspace_support) {
      let totalFiles = 0;
      logger.log('[fish-lsp] workspace folder capability not enabled');
      for (const workspace of workspaces) {
        amount = 0;
        if (!workspace.isAnalyzed()) {
          workspace.setAnalyzed();
          const upperBound = Math.min(workspace.uris.size, max_files);
          for (const uri of Array.from(workspace.uris)) {
            const reportPercent = amount / upperBound * 100;
            progress.report(Math.floor(reportPercent));
            if (amount >= max_files) break;
            this.analyzePath(uri);
            amount++;
          }
          callbackfn(`[fish-lsp] analyzed ${workspace.uris.size} files`);
          totalFiles += amount;
        }
      }
      progress.done();
      return { filesParsed: totalFiles };
    }
    // if there is a workspace folder capability, we can just analyze the current workspace
    const workspace = currentWorkspace.current;
    logger.log('workspace analyzer.initiateBackgroundAnalysis', {
      workspace: {
        name: workspace?.name,
        path: workspace?.path,
        uri: workspace?.uri,
        isAnalyzed: workspace?.isAnalyzed(),
        size: workspace?.uris.size,
      },
      max_files,
    });

    if (!workspace) {
      progress.done();
      return { filesParsed: 0 };
    }
    const workspaceUri = currentWorkspace.current?.uri || '';
    if (!!workspaceUri && workspace.isAnalyzed()) {
      progress.done();
      return { filesParsed: 0 };
    }
    workspace.setAnalyzed();

    for (const document of workspace.urisToLspDocuments()) {
      const reportPercent = amount / workspace.uris.size * 100;
      progress.report(Math.floor(reportPercent));
      if (amount >= max_files) break;
      try {
        this.analyze(document);
      } catch (err) {
        logger.log(err);
      }
      amount++;
    }
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    progress.done();
    callbackfn(`[fish-lsp] analyzed ${amount} files in ${duration}s`);
    return { filesParsed: amount };
  }

  public clearWorkspace(workspace: Workspace, currentUri: string, ...openUris: string[]): void {
    const remainingUrisInWorkspace = openUris.filter(uri => {
      return workspace.contains(uri) && uri !== currentUri;
    });
    const removedUris: string[] = [];

    if (remainingUrisInWorkspace.length === 0) {
      workspace.removeAnalyzed();
      this.cache.uris().forEach(uri => {
        if (workspace.contains(uri)) {
          removedUris.push(uri);
          this.cache.clear(uri);
        }
      });
      this.globalSymbols.allNames.forEach(name => {
        const symbols = this.globalSymbols.find(name)
          .filter(s => !workspace.contains(s.uri));
        if (symbols.length === 0) {
          this.globalSymbols.map.delete(name);
          return;
        }
        this.globalSymbols.map.set(name, symbols);
      });
    }
    this.amountIndexed = 0;
    logger.log(`Cleared workspace ${workspace.path}`);
    logger.log({
      removedUris: removedUris.length,
      remainingUris: this.cache.uris().length,
    });
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
    const uris = this.cache.uris();
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
    const uris = this.cache.uris();
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
    const currentWs = currentWorkspace.current;
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

  public allSymbolsAccessibleAtPosition(
    document: LspDocument,
    position: Position,
  ): FishSymbol[] {
    // Set to avoid duplicate symbols
    const symbolNames: Set<string> = new Set();
    // add the local symbols
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri))
      .filter((symbol) => symbol.scope.containsPosition(position));
    symbols.forEach((symbol) => symbolNames.add(symbol.name));
    // add the sourced symbols
    const sourcedUris = this.collectReachableSources(document.uri, position);
    for (const sourcedUri of sourcedUris) {
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
    const workspace = currentWorkspace.current;
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
  private getDefinitionHelper(
    document: LspDocument,
    position: Position,
  ): FishSymbol[] {
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
   */
  public getDefinition(
    document: LspDocument,
    position: Position,
  ): FishSymbol | null {
    const symbols: FishSymbol[] = this.getDefinitionHelper(document, position);
    const wordAtPoint = this.wordAtPoint(document.uri, position.line, position.character);
    const nodeAtPoint = this.nodeAtPoint(document.uri, position.line, position.character);
    if (nodeAtPoint && isAliasDefinitionName(nodeAtPoint)) {
      return symbols.find(s => s.name === wordAtPoint) || symbols.pop()!;
    }
    if (nodeAtPoint && isArgparseVariableDefinitionName(nodeAtPoint)) {
      return this.getFlatDocumentSymbols(document.uri).findLast(s => s.containsPosition(position)) || symbols.pop()!;
    }
    if (nodeAtPoint && nodeAtPoint.parent && isCompletionDefinition(nodeAtPoint.parent)) {
      const completionSymbols = this.getFlatCompletionSymbols(document.uri);
      const completionSymbol = completionSymbols.find(s => s.equalsNode(nodeAtPoint));
      if (!completionSymbol) {
        return null;
      }
      const { argparseFlagName, commandName } = completionSymbol.toArgparse(nodeAtPoint);
      const symbol = this.findSymbol((s) =>
        s.fishKind === 'ARGPARSE' &&
        argparseFlagName.includes(s.name) && s.node.parent?.firstNamedChild?.text === commandName,
      );
      if (symbol) {
        logger.log('got symbol', symbol.name);
        return symbol;
      }
    }
    if (nodeAtPoint && isOption(nodeAtPoint)) {
      logger.log('definition  isOption');
      const symbol = this.findSymbol((s) => {
        if (s.parent && s.fishKind === 'ARGPARSE') {
          return nodeAtPoint.parent?.firstNamedChild?.text === s.parent?.name &&
            s.parent.isGlobal() &&
            nodeAtPoint.text.startsWith(s.argparseFlag);
        }
        return false;
      });
      if (symbol) {
        return symbol;
      }
    }
    return symbols.pop() || null;
  }

  /**
   * Get all the definition locations of a position that we can find
   */
  public getDefinitionLocation(
    document: LspDocument,
    position: Position,
  ): LSP.Location[] {
    // handle source argument definition location
    const node = this.nodeAtPoint(document.uri, position.line, position.character);
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

    const symbol = this.getDefinition(document, position) as FishSymbol;
    if (symbol) {
      return [Location.create(symbol.uri, symbol.selectionRange)];
    }
    // this is the only location where `config.fish_lsp_single_workspace_support` is used
    if (!config.fish_lsp_single_workspace_support && currentWorkspace.current) {
      const node = this.nodeAtPoint(document.uri, position.line, position.character);
      if (node && isCommandName(node)) {
        const text = node.text.toString();
        const locations = execCommandLocations(text);
        for (const { uri, path } of locations) {
          const content = SyncFileHelper.read(path, 'utf8');
          const doc = LspDocument.createTextDocumentItem(uri, content);
          documents.open(doc);
          currentWorkspace.updateCurrent(doc);
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
   * Here we can allow the user to use completion locations for the implementation
   */
  public getImplementation(
    document: LspDocument,
    position: Position,
  ): Location[] {
    const definition = this.getDefinition(document, position);
    if (!definition) return [];
    const locations = implementationLocation(this, document, position);
    return locations;
  }

  /**
   * Gets the location of the sourced file for the given source command argument name node.
   */
  private getSourceDefinitionLocation(
    node: SyntaxNode,
  ): LSP.Location[] {
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

  public getHover(document: LspDocument, position: Position): Hover | null {
    const tree = this.getTree(document.uri);
    const node = this.nodeAtPoint(
      document.uri,
      position.line,
      position.character,
    );
    if (!tree || !node) {
      return null;
    }

    const symbol =
      this.getDefinition(document, position) as FishSymbol ||
      this.globalSymbols.findFirst(node.text);
    if (symbol) {
      logger.log(`analyzer.getHover: ${symbol.name}`, {
        name: symbol.name,
        uri: symbol.uri,
        detail: symbol.detail,
        text: symbol.node.text,
        kind: symbolKindToString(symbol.kind),
      });
      return symbol.toHover();
    }
    return null;
  }

  getTree(documentUri: string): Tree | undefined {
    return this.cache.getDocument(documentUri)?.tree;
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
    const { document, tree } = doc;
    const rootNode = tree.rootNode;
    const childrenSymbols = getChildNodes(rootNode)
      .filter(n => isCompletionDefinition(n));
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
   * Returns a list of all the command names in the document
   */
  private getCommandNames(documentUri: string): string[] {
    const allCommands = this.getNodes(documentUri)
      .filter((node) => isCommandName(node))
      .map((node) => node.text);
    const result = new Set(allCommands);
    return Array.from(result);
  }

  /**
   * Utility to collect all the sources in the input documentUri, or if specified
   * it will only collect the included sources from the sources parameter
   * @param documentUri - the uri of the document to collect sources from
   * @param sources - the sources to collect from (optional set to narrow results)
   * @returns {Set<string>} - a flat set of all the sourceUri's reachable from the input sources
   */
  private collectSources(
    documentUri: string,
    sources = this.cache.getSources(documentUri),
  ): Set<string> {
    const visited = new Set<string>();
    const collectionStack: string[] = Array.from(sources);
    while (collectionStack.length > 0) {
      const source = collectionStack.pop()!;
      if (visited.has(source)) continue;
      visited.add(source);
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
  public collectReachableSources(
    documentUri: string,
    position: Position,
  ): Set<string> {
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
      },
      );
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
    for (const source of allSources) {
      const sourceDoc = this.cache.getDocument(source);
      if (!sourceDoc) {
        this.analyzePath(source);
      }
    }
    return allSources;
  }

  public parsePosition(
    document: LspDocument,
    position: Position,
  ): { root: SyntaxNode | null; currentNode: SyntaxNode | null; } {
    const root = this.getRootNode(document.uri) || null;
    return {
      root: root,
      currentNode:
        root?.descendantForPosition({
          row: position.line,
          column: Math.max(0, position.character - 1),
        }) || null,
    };
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

    if (isAliasDefinitionName(node)) {
      return node.text.split('=')[0]!.trim();
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

    if (!node) {
      return null;
    }

    const firstChild = node.firstNamedChild;

    if (!firstChild || !isCommandName(firstChild)) {
      return null;
    }

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

  public getExistingAutoloadedFiles(symbol: FishSymbol): string[] {
    if (!symbol.uri.includes(`functions/${symbol.name}.fish`)) {
      return [];
    }
    const workspace = workspaces.find(ws => ws.contains(symbol.uri));
    if (!workspace) {
      return [];
    }
    const searchNames = [
      `${workspace.path}/functions/${symbol.name}.fish`,
      `${workspace.path}/completions/${symbol.name}.fish`,
    ];
    return searchNames
      .filter((path) => existsSync(path))
      .map((path) => pathToUri(path));
  }

  public getMissingAutoloadedFiles(uri: string, name: string): string[] {
    const searchWorkspace = workspaces.find(ws => ws.contains(uri));
    if (!searchWorkspace) {
      return [];
    }
    const uris = searchWorkspace.findMatchingFishIdentifiers(name);
    return uris.filter(uri => {
      return !this.cache.uris().includes(uri);
    });
  }
}
export class GlobalDefinitionCache {
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

export class AnalyzedDocumentCache {
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

export class SymbolCache {
  constructor(
    private _names: Set<string> = new Set(),
    private _variables: Map<string, FishSymbol[]> = new Map(),
    private _functions: Map<string, FishSymbol[]> = new Map(),
  ) { }

  add(symbol: FishSymbol): void {
    const oldVars = this._variables.get(symbol.name) || [];
    switch (symbol.kind) {
      case SymbolKind.Variable:
        this._variables.set(symbol.name, [...oldVars, symbol]);
        break;
      case SymbolKind.Function:
        this._functions.set(symbol.name, [...oldVars, symbol]);
        break;
    }
    this._names.add(symbol.name);
  }

  isVariable(name: string): boolean {
    return this._variables.has(name);
  }

  isFunction(name: string): boolean {
    return this._functions.has(name);
  }

  has(name: string): boolean {
    return this._names.has(name);
  }
}
