import { Hover, MarkupContent, MarkupKind, Position, SymbolKind, WorkspaceSymbol, URI, Location } from 'vscode-languageserver';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { isPositionWithinRange, getChildNodes } from './utils/tree-sitter';
import { LspDocument } from './document';
import { isCommand, isCommandName } from './utils/node-types';
import { pathToUri, symbolKindToString } from './utils/translation';
import { existsSync } from 'fs';
import { currentWorkspace, workspaces } from './utils/workspace';
import { findDefinitionSymbols } from './workspace-symbol';
import { config } from './config';
import { logger } from './logger';
import { execFileSync } from 'child_process';
import { documents } from './server';
import { SyncFileHelper } from './utils/file-operations';
import { FishSymbol, processNestedTree } from './parsing/symbol';
import { flattenNested } from './utils/flatten';

export class Analyzer {
  protected parser: Parser;
  public cache: AnalyzedDocumentCache = new AnalyzedDocumentCache();
  public globalSymbols: GlobalDefinitionCache = new GlobalDefinitionCache();

  public amountIndexed: number = 0;

  constructor(parser: Parser) {
    this.parser = parser;
  }

  public analyze(document: LspDocument): FishSymbol[] {
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
    return this.cache.getDocumentSymbols(document.uri);
  }

  private getAnalyzedDocument(
    parser: Parser,
    document: LspDocument,
  ): AnalyzedDocument {
    const tree = parser.parse(document.getText());
    const documentSymbols = processNestedTree(
      document,
      tree.rootNode,
    );
    const commands = this.getCommandNames(document);
    return AnalyzedDocument.create(
      document,
      documentSymbols,
      commands,
      tree,
    );
  }

  public async initiateBackgroundAnalysis(
    callbackfn: (text: string) => void,
  ): Promise<{ filesParsed: number; }> {
    const startTime = performance.now();
    const max_files = config.fish_lsp_max_background_files;

    let amount = 0;

    const analysisPromises: Promise<void>[] = [];

    for (const workspace of workspaces) {
      const docs = workspace
        .urisToLspDocuments()
        // .filter((doc: LspDocument) => doc.shouldAnalyzeInBackground())
        .filter((doc: LspDocument) => doc.isAutoloadedUri())
        .slice(0, max_files - amount); // Only take what we need up to max_files

      // Create promises for each document analysis
      const workspacePromises = docs.map(async (doc) => {
        if (amount >= max_files) {
          return;
        }
        try {
          this.analyze(doc);
        } catch (err) {
          logger.log(err);
        }
        amount++;
      });

      analysisPromises.push(...workspacePromises);

      if (amount >= max_files) {
        break;
      }
    }

    // Wait for all analysis tasks to complete
    await Promise.all(analysisPromises);

    this.amountIndexed = amount;

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    callbackfn(`[fish-lsp] analyzed ${amount} files in ${duration}s`);
    logger.log(`[fish-lsp] analyzed ${amount} files in ${duration}s`);
    return { filesParsed: amount };
  }

  public findDocumentSymbol(
    document: LspDocument,
    position: Position,
  ): FishSymbol | undefined {
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri));
    const wordAtPoint = this.wordAtPoint(document.uri, position.line, position.character);
    // const nodeAtPoint = this.nodeAtPoint(document.uri, position.line, position.character);
    return symbols.find((symbol) => {
      if (symbol.kind === SymbolKind.Function && wordAtPoint === symbol.name) {
        return symbol.scope.containsPosition(position);
      }
      if (symbol.fishKind === 'ARGPARSE' && wordAtPoint === symbol.name.replace(/^_flag_/, '')) {
        return true;
      }
      return isPositionWithinRange(position, symbol.selectionRange);
    });
  }

  public findDocumentSymbols(
    document: LspDocument,
    position: Position,
  ): FishSymbol[] {
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri));
    return symbols.filter((symbol) => {
      return isPositionWithinRange(position, symbol.selectionRange);
    });
  }

  public allSymbolsAccessibleAtPosition(
    document: LspDocument,
    position: Position,
  ): FishSymbol[] {
    const symbols = flattenNested(...this.cache.getDocumentSymbols(document.uri))
      .filter((symbol) => symbol.scope.containsPosition(position));
    const globalSymbols = this.globalSymbols.allSymbols.filter((symbol) => {
      if (symbol.uri !== document.uri) {
        return !symbols.some((s) => s.name === symbol.name);
      }
      return true;
    });

    return [
      ...symbols,
      ...globalSymbols,

    ];
  }

  /**
    * method that returns all the workspaceSymbols that are in the same scope as the given
    * shell
    * @returns {WorkspaceSymbol[]} array of all symbols
    */
  public getWorkspaceSymbols(query: string = ''): WorkspaceSymbol[] {
    if (config.fish_lsp_single_workspace_support && currentWorkspace.current) {
      const workspace = currentWorkspace.current;
      logger.log({ searching: workspace.path, query });
      return this.globalSymbols.allSymbols
        .filter(symbol => workspace.contains(symbol.uri))
        .map((s) => s.toWorkspaceSymbol())
        .filter((symbol: WorkspaceSymbol) => {
          return symbol.name.startsWith(query);
        });
    }
    return this.globalSymbols.allSymbols
      .map((s) => s.toWorkspaceSymbol())
      .filter((symbol: WorkspaceSymbol) => {
        return symbol.name.startsWith(query);
      });
  }

  public getDefinition(
    document: LspDocument,
    position: Position,
  ): FishSymbol {
    const symbols: FishSymbol[] = findDefinitionSymbols(this, document, position);
    const wordAtPoint = this.wordAtPoint(document.uri, position.line, position.character);
    return symbols.find(s => s.name === wordAtPoint)!;
  }

  public getDefinitionLocation(
    document: LspDocument,
    position: Position,
  ): LSP.Location[] {
    const symbol = this.getDefinition(document, position) as FishSymbol;
    if (symbol) {
      return [
        Location.create(symbol.uri, symbol.selectionRange),
      ];
    }
    if (config.fish_lsp_single_workspace_support && currentWorkspace.current) {
      const node = this.nodeAtPoint(document.uri, position.line, position.character);
      if (node && isCommandName(node)) {
        const text = node.text.toString();
        logger.log('isCommandName', text);
        const location = execFileSync('fish', ['--command', `type -ap ${text}`], {
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        logger.log({ location: location.toString() });
        for (const path of location.toString().trim().split('\n')) {
          const uri = pathToUri(path);
          const content = SyncFileHelper.read(path, 'utf8');
          const doc = LspDocument.create(uri, content);
          documents!.open(path, doc.asTextDocumentItem());
          currentWorkspace.updateCurrent(doc);
        }

        return location.toString().trim().split('\n').map((path: string) => {
          return Location.create(pathToUri(path), {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          });
        });
      }
    }
    return [];
  }

  public getHover(document: LspDocument, position: Position): Hover | null {
    const tree = this.getTree(document);
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
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: symbol.detail,
        } as MarkupContent,
      };
    }
    return null;
  }

  //public findCompletions(
  //    document: LspDocument,
  //    position: Position,
  //    data: FishCompletionData
  //): FishCompletionItem[] {
  //    const symbols = this.cache.getDocumentSymbols(document.uri);
  //    const localSymbols = findSymbolsForCompletion(symbols, position);
  //
  //    const globalSymbols = this.globalSymbols
  //        .uniqueSymbols()
  //        .filter((s) => !localSymbols.some((l) => s.name === l.name))
  //        .map((s) => FishDocumentSymbol.toGlobalCompletion(s, data));
  //
  //    return [
  //        ...localSymbols.map((s) =>
  //            FishDocumentSymbol.toLocalCompletion(s, data)
  //        ),
  //        ...globalSymbols,
  //    ];
  //}

  getTree(document: LspDocument): Tree | undefined {
    return this.cache.getDocument(document.uri)?.tree;
  }

  /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
  getRootNode(document: LspDocument): SyntaxNode | undefined {
    return this.cache.getParsedTree(document.uri)?.rootNode;
  }

  getDocument(documentUri: string): LspDocument | undefined {
    return this.cache.getDocument(documentUri)?.document;
  }

  getDocumentSymbols(documentUri: string): FishSymbol[] {
    return this.cache.getDocumentSymbols(documentUri);
  }

  getFlatDocumentSymbols(documentUri: string): FishSymbol[] {
    return this.cache.getFlatDocumentSymbols(documentUri);
  }
  public parsePosition(
    document: LspDocument,
    position: Position,
  ): { root: SyntaxNode | null; currentNode: SyntaxNode | null; } {
    const root = this.getRootNode(document) || null;
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
    //const linePreTrim: string = document.getLineBeforeCursor(position);
    //const line = linePreTrim.slice(0,linePreTrim.lastIndexOf('\n'));
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

  public getNodes(document: LspDocument): SyntaxNode[] {
    return getChildNodes(this.parser.parse(document.getText()).rootNode);
  }

  private getCommandNames(document: LspDocument): string[] {
    const allCommands = this.getNodes(document)
      .filter((node) => isCommandName(node))
      .map((node) => node.text);
    const result = new Set(allCommands);
    return Array.from(result);
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

type AnalyzedDocument = {
  document: LspDocument;
  documentSymbols: FishSymbol[];
  commands: string[];
  tree: Parser.Tree;
};

export namespace AnalyzedDocument {
  export function create(document: LspDocument, documentSymbols: FishSymbol[], commands: string[], tree: Parser.Tree): AnalyzedDocument {
    return {
      document,
      documentSymbols,
      commands,
      tree,
    };
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
