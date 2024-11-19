import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { LspDocument } from './document';
import { FishSymbol, FishSymbolHash, getScopedFishSymbols } from './utils/symbol';
import * as LSP from 'vscode-languageserver';
import { /* ancestorMatch, containsRange, isPositionBefore, */ getChildNodes, getNodeAtPosition, getRange, positionToPoint, getNodeAtPoint } from './utils/tree-sitter';
import { isSourceFilename } from './diagnostics/node-types';
import { SyncFileHelper } from './utils/file-operations';
import { Location, Position /*, SymbolKind */ } from 'vscode-languageserver';
import { isCommand, isCommandName /*, isType */ } from './utils/node-types';
import { execEscapedSync } from './utils/exec';
import { flattenNested } from './utils/flatten';
import * as Locations from './utils/locations';
// import { isBuiltin } from './utils/builtins';
import { Point } from 'tree-sitter';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { getPrebuiltSymbolInfo } from './features/prebuilt-symbol-info';
import { FishCompletionItem } from './utils/completion/types';
import { FishWorkspace } from './utils/workspace';
import { config } from './cli';

export type AnalyzedDocument = {
  document: LspDocument;
  symbols: FishSymbol[];
  tree: Tree;
  root: SyntaxNode;
  nodes: SyntaxNode[];
  sourcedFiles: string[];
};

interface CursorAnalysis {
  lastNode: Parser.SyntaxNode | null;
  lastCommand: Parser.SyntaxNode | null;
  docTextBeforeCursor: string;
  line: string;
  isLastNode: boolean;
  endswithSpace: boolean;
  trailingSemi: boolean;
  word: string;
  commandName: string;
  argumentIndex: number;
}

/**
 * A PAST-DUE, PROJECT-WIDE REFACTORING OF `./analyze.ts`
 *
 * What is the goal here?
 *   - [ ] ./src/analyze.ts but easier to test
 *   - [ ] ./src/analyze.ts but clearer in scope && usage
 *   - [ ] ./src/analyze.ts but smaller and better structured
 *   - [ ] ./src/analyze.ts but extendable & maintainable
 */
export class Analyzer { // @TODO rename to Analyzer
  public cached: Map<string, AnalyzedDocument> = new Map();
  public workspaceSymbols: Map<string, FishSymbol[]> = new Map();

  constructor(private parser: Parser, private workspaces: FishWorkspace[] = []) { }

  private createAnalyzedDocument(document: LspDocument): AnalyzedDocument {
    // this.parser.reset();
    const tree = this.parser.parse(document.getText());
    const root = tree.rootNode;
    const nodes = getChildNodes(root);
    const symbols = getScopedFishSymbols(root, document.uri);

    const sourcedFiles = nodes
      .filter(isSourceFilename)
      .map(n => n.text);

    const workspaceSymbols = flattenNested(...symbols)
      .filter(s => s.isGlobalScope());

    for (const symbol of workspaceSymbols) {
      const currentSymbols = this.workspaceSymbols.get(symbol.name) || [];
      currentSymbols.push(symbol);
      this.workspaceSymbols.set(symbol.name, currentSymbols);
    }

    return {
      document,
      tree,
      root,
      nodes,
      symbols,
      sourcedFiles,
    };
  }

  analyze(document: LspDocument): AnalyzedDocument {
    const analyzed = this.createAnalyzedDocument(document);
    this.cached.set(document.uri, analyzed);
    return analyzed;
  }

  /**
   * A wrapper for this.analyze(). Creates an LspDocument from a filepath and analyzes it.
   * @returns LspDocument - the document analyzed
   */
  analyzeFilepath(filepath: string) {
    const document = SyncFileHelper.toLspDocument(filepath, 'fish', 1);
    return this.analyze(document);
  }

  /**
   * call at startup to analyze in gackground
   */
  async initializeBackgroundAnalysis(callbackfn: (text: string) => void) {
    let currentIdx = 0;
    while (currentIdx < config.fish_lsp_max_background_files) {
      this.workspaces.forEach(async (workspace) => {
        if (currentIdx >= config.fish_lsp_max_background_files) return;
        return workspace.urisToLspDocuments().map(doc => {
          this.analyze(doc);
          currentIdx++;
        });
      });
    }
    if (config.fish_lsp_show_client_popups) {
      callbackfn(`[fish-lsp] analyzed ${currentIdx} files`);
    }
    return {
      filesParsed: currentIdx,
    };
  }

  /**
   * getDocumentSymbols - gets all uris analyzed
   */
  get uris() {
    return Array.from(this.cached.keys());
  }

  get cachedEntries() {
    return Array.from(this.cached.entries());
  }

  /**
   * @TODO: FIX
   * getDefinitionSymbol - get definition symbol in a LspDocument
   */
  getDefinitionSymbol(document: LspDocument, position: Position): FishSymbol[] {
    const cached = this.cached.get(document.uri);
    if (!cached) return [];

    const node = getNodeAtPosition(cached.tree, position);
    if (!node) return [];

    const text = node.text;
    const matchingSymbols = symbolsScopeContainsPosition(
      flattenNested(...cached.symbols),
      text,
      position,
    );
    const symbol = matchingSymbols.at(0);

    // console.log({ containsSymbols: symbols.map(s => s.name), node: node.text });

    if (symbol) {
      return [symbol];
    }

    const globalSymbols = this.workspaceSymbols.get(text) || [];
    if (globalSymbols.length > 0) {
      return globalSymbols;
    }

    // execute shell command to get definition
    /**
     * // const definitionFilepath = await this.getDefinition(document.uri, position);
     * // const cachedDef = this.analyzeFilepath(definitionFilepath);
     * // return cachedDef.symbols.flat().filter(s => s.name === text);
     */
    if (!text.startsWith('$')) {
      const commandOutput = execEscapedSync(`type -a -p ${text}`);

      if (commandOutput.startsWith('/') && commandOutput.endsWith('.fish')) {
        const cachedDef = this.analyzeFilepath(commandOutput);
        return [
          ...flattenNested(...cachedDef.symbols).filter(s => s.name === text),
        ];
      }
    }

    return [];
  }

  findNodesInRanges(ranges: LSP.Range[], root: SyntaxNode): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const child of getChildNodes(root)) {
      if (ranges.some(r => Locations.Range.containsRange(r, Locations.Range.fromNode(child)))) {
        result.push(child);
      }
    }
    return result;
  }

  private removeLocalSymbols(
    matchSymbol: FishSymbol,
    tree: Tree,
    symbols: FishSymbol[],
  ) {
    // const name = matchSymbol.name;
    const matchingSymbols = flattenNested(...symbols)
      .filter(s => s.name === matchSymbol.name && s.isLocalScope());
    // .map(s => s.getLocalCallableRanges());

    const result: SyntaxNode[] = [];
    for (const node of getChildNodes(tree.rootNode)) {
      // const nodeRange = getRange(node);
      const nodeLocation = Locations.Position.fromSyntaxNode(node);
      if (!matchingSymbols.some(s => s.isCallableAtPosition(nodeLocation))) {
        result.push(node);
      }
    }

    return result;
  }

  private findLocalLocations(document: LspDocument, position: Position) {
    const tree = this.cached.get(document.uri)?.tree;
    if (!tree) return [];

    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (!symbol) return [];

    const result: LSP.Location[] = [];
    for (const child of this.findNodesInRanges(symbol.getLocalCallableRanges(), tree.rootNode)) {
      if (child.text === symbol.name && ['word', 'variable_name'].includes(child.type)) {
        result.push(Location.create(document.uri, getRange(child)));
      }
    }
    return result;
  }

  private findGlobalLocations(document: LspDocument, position: Position) {
    const locations: LSP.Location[] = [];
    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (!symbol) return locations;

    for (const uri of this.uris) {
      const cached = this.cached.get(uri);
      if (!cached) continue;

      const toSearchNodes = this.removeLocalSymbols(
        symbol,
        cached.tree,
        cached.symbols.flat(),
      );
      const newLocations = findLocations(uri, toSearchNodes, symbol.name);
      locations.push(...newLocations);
    }
    return locations;
  }

  getReferences(document: LspDocument, position: Position): LSP.Location[] {
    const tree = this.cached.get(document.uri)?.tree;
    if (!tree) return [];

    const node = getNodeAtPoint(tree, { line: position.line, column: position.character });
    if (!node) return [];

    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (symbol) {
      switch (symbol.modifier) {
        case 'UNIVERSAL':
        case 'GLOBAL':
          return this.findGlobalLocations(document, position);
        case 'FUNCTION':
        case 'LOCAL':
        default:
          return this.findLocalLocations(document, position);
      }
    }

    if (isCommandName(node)) {
      const locations: Location[] = [];
      for (const [uri, cached] of this.cachedEntries) {
        const rootNode = cached.root;
        const nodes = getChildNodes(rootNode).filter(n => isCommandName(n));
        const newLocations = findLocations(uri, nodes, node.text);
        locations.push(...newLocations);
      }
      return locations;
    }

    return [];
  }


  //
  // @TODO - use locations
  // https://github.com/ndonfris/fish-lsp/blob/782e14a2d8875aeeddc0096bf85ca1bc0d7acc77/src/workspace-symbol.ts#L139
  /**
   * getReferenceSymbols - gets all references of a symbol in a LspDocument
   */
  // getReferences(document: LspDocument, position: Position): LSP.Location[] {
  //   const cached = this.cached.get(document.uri)
  //   if (!cached) return []
  //
  //   const toFind = getNodeAtPosition(cached.tree, position);
  //   if (!toFind) return [];
  //
  //   const result: LSP.Location[] = [];
  //   // const current = this.cached.get(document.uri).symbols;
  //
  //   const defSymbol = this.getDefinitionSymbol(document, position).pop()
  //   // if ()
  //
  //   if (cached.symbols.flat().length === 0) return result;
  //   // const defSymbol  = filterSymbolsInScope(cached.symbols.nested(), position).pop()
  //   if (!defSymbol) return result;
  //
  //   if (defSymbol.scope.scopeTag !== 'global') {
  //     return this.getLocalLocations(document, position);
  //   }
  //
  //   return this.getGlobalLocations(document, position);
  //   // const uniqueLocations = new UniqueLocations();
  //   // for (const [uri, cached] of Array.from(this.cached.entries())) {
  //   //   this.getLocalLocations(cached.document, position)
  //   //   const getIncludedNodes = (  ) => {
  //   //     if (defSymbol.scope.scopeTag !== 'global') {
  //   //       return getChildNodes(defSymbol.scope.scopeNode)
  //   //     }
  //   //     return cached.nodes
  //   //   }
  //   //
  //   //
  //   //   // for (const node of possibleNodes) {
  //   //   //   if (node.text !== defSymbol.name) continue;
  //   //   //   const range = getRange(node);
  //   //   //   if (node.text === defSymbol.name) {
  //   //   //     uniqueLocations.add(LSP.Location.create(uri, range))
  //   //   //   }
  //   //   // }
  //   // }
  //   // return uniqueLocations.locations;
  // }

  /**
   * getHover - gets the hover documentation of a symbol in a LspDocument
   */
  getHover(document: LspDocument, position: Position): LSP.Hover | undefined {
    const cached = this.cached.get(document.uri);
    if (!cached) return undefined;

    const node = getNodeAtPosition(cached.tree, position);
    if (!node) return undefined;

    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (symbol) {
      return {
        contents: symbol.detail,
        range: symbol.range,
      };
    }
    return undefined;
  }

  getPrebuiltSymbol(document: LspDocument, position: Position): FishSymbol | null {
    const tree = this.cached.get(document.uri)?.tree;
    const doc = this.cached.get(document.uri)?.document;
    if (!tree || !doc) return null;

    const cursor = this.analyzeCursorPosition(doc.uri, position.line, position.character);
    const commandName = cursor.commandName || '';
    const lastNode = cursor.lastNode;
    const commandNode = cursor.lastCommand;

    let focusedSymbol: FishSymbol | undefined = undefined;

    if (['set', 'read'].includes(commandName)) {
      focusedSymbol = flattenNested(...this.cached.get(doc.uri)?.symbols || [])
        .find(sym => {
          if (sym.isVariable() &&
            ['set', 'read'].includes(sym.getParentKeyword()) &&
            PrebuiltDocumentationMap.getByName(sym.name) &&
            Locations.Range.containsRange(
              Locations.Range.fromNode(sym.parentNode),
              Locations.Range.fromNode(cursor.lastNode!))
          ) {
            return true;
          }
          return false;
        });
    }
    if (
      focusedSymbol === undefined
      && PrebuiltDocumentationMap.getByName(commandName)
      && commandNode && lastNode
    ) {
      const cmdPos = Locations.Position.fromSyntaxNode(commandNode);
      focusedSymbol = this.getDefinitionSymbol(document, cmdPos).pop()!;
    }
    return focusedSymbol || null;
  }

  getPrebuiltSymbolInfo(document: LspDocument, position: Position): string | null {
    const symbol = this.getPrebuiltSymbol(document, position);
    if (symbol) return getPrebuiltSymbolInfo(symbol);
    return null;
  }

  /**
  * getCompletionSymbols - local symbols to send to a onCompletion request in server
  * @returns FishDocumentSymbol[]
  */
  getCompletionSymbols(document: LspDocument, position: Position): FishCompletionItem[] {
    const cached = this.cached.get(document.uri);
    if (!cached?.symbols || !cached.tree) return [];
    const symbols = cached.symbols;

    const currentNode = getNodeAtPosition(cached.tree, position);
    if (!currentNode) return [];

    const flatSymbols = flattenNested(...symbols)
      .filter((symbol) => symbol.isCallableAtPosition(position));

    /** returns the unique CompletionItem array, removing items after their first occurrence */
    return [
      ...flatSymbols.map(s => s.toCompletionItem()),
      ...Array.from(this.workspaceSymbols.values())
        .filter(val => val.at(0)!.uri !== document.uri) /* remove functions that aren't callable at our document's position */
        .map(val => val.at(0)!.toCompletionItem()),
    ].filter((item, index, array) =>
      array.findIndex(other => other.label === item.label) === index,
    );
  }

  getNodeAtRange(uri: string, range: LSP.Range): SyntaxNode | undefined {
    const cached = this.cached.get(uri);
    if (!cached) return;
    return cached.tree.rootNode.descendantForPosition(positionToPoint(range.start));
  }

  getNodeAtLocation(location: LSP.Location): SyntaxNode | undefined {
    return this.getNodeAtRange(location.uri, location.range);
  }

  /**
   * Find the node at the given point.
   */
  public nodeAtPoint(
    uri: string,
    line: number,
    column: number,
  ): Parser.SyntaxNode | null {
    const tree = this.cached.get(uri)?.tree;
    if (!tree?.rootNode) {
      // Check for lacking rootNode (due to failed parse?)
      return null;
    }
    return tree.rootNode.descendantForPosition({ row: line, column });
  }

  /**
   * Finds the last valid node at a given point in the document.
   * Handles cases where nodes may be null, missing, or have errors.
   */
  public lastNodeAtPoint(
    tree: Tree,
    line: number,
    column: number,
  ): Parser.SyntaxNode | null {
    if (!tree?.rootNode) {
      return null;
    }

    for (const node of tree.rootNode.descendantsOfType('command')) {
      if (Locations.Range.containsPosition(
        Locations.Range.fromNode(node),
        Locations.Position.create(line, column),
      )) {
        return node.lastNamedChild;
      }
    }

    return null;
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

  public commandNodeAtPoint(
    uri: string,
    line: number,
    column: number,
  ): SyntaxNode | null {
    let node = this.nodeAtPoint(uri, line, column);

    while (node && !isCommand(node)) {
      node = node.parent;
    }

    return node;
  }

  public commandArgumentIndexAtPoint(
    uri: string,
    line: number,
    column: number,
  ): number | null {
    const commandNode = this.commandNodeAtPoint(uri, line, column);

    if (!commandNode) {
      return null;
    }

    const commandArguments = commandNode.children.filter(arg => {
      return Locations.Position.isBeforeOrEqual(
        Locations.Position.fromSyntaxNode(arg),
        Locations.Position.create(line, column),
      );
    });

    return commandArguments.length - 1;
  }

  /**
   * Finds the last valid syntax node before or at the given cursor position.
   * This method traverses the syntax tree to find nodes that end before or at the cursor,
   * handling both single-line and multi-line cases.
   * 
   * @param uri - The document URI to search in
   * @param line - The cursor's line number (0-based)
   * @param column - The cursor's column number (0-based)
   * @returns The last syntax node before the cursor, or null if none found
   */
  findLastNodeBeforeCursor(
    uri: string,
    line: number,
    column: number
  ): Parser.SyntaxNode | null {
    const cached = this.cached.get(uri);
    if (!cached?.tree?.rootNode) {
      return null;
    }

    const cursorPoint = { row: line, column };
    let lastValidNode: Parser.SyntaxNode | null = null;
    let maxEndPosition = { row: -1, column: -1 };

    // Helper to check if a position is before or at cursor
    const isBeforeOrAtCursor = (pos: Parser.Point) => {
      return pos.row < cursorPoint.row ||
        (pos.row === cursorPoint.row && pos.column <= cursorPoint.column);
    };

    // Traverse all named nodes in the document
    const cursor = cached.tree.rootNode.walk();
    let shouldDescend = true;

    while (true) {
      if (shouldDescend && cursor.gotoFirstChild()) {
        continue;
      }

      // Check current node
      const currentNode = cursor.currentNode;
      if (currentNode.isNamed &&
        isBeforeOrAtCursor(currentNode.endPosition) &&
        (currentNode.endPosition.row > maxEndPosition.row ||
          (currentNode.endPosition.row === maxEndPosition.row &&
            currentNode.endPosition.column > maxEndPosition.column))) {
        lastValidNode = currentNode;
        maxEndPosition = currentNode.endPosition;
      }

      if (cursor.gotoNextSibling()) {
        shouldDescend = true;
      } else {
        if (!cursor.gotoParent()) {
          break;
        }
        shouldDescend = false;
      }
    }

    // Handle special cases where we're at a missing node or error node
    if (lastValidNode?.isMissing && lastValidNode.previousSibling) {
      return lastValidNode.previousSibling;
    }

    return lastValidNode;
  }

  public analyzeCursorPosition(
    uri: string,
    line: number,
    column: number,
  ): CursorAnalysis {
    const cached = this.cached.get(uri);

    if (!cached?.document || !cached?.tree) return CursorAnalysis.createEmpty();

    const point = { row: line, column };

    // const lastNode = this.lastNodeAtPoint(cached.tree, line, column);
    const lastNode = this.findLastNodeBeforeCursor(uri, line, column);
    if (!lastNode) return CursorAnalysis.createWithDoc(
      cached.document.getLineBeforeCursor({ line, character: column }),
      cached.document.getTextBeforeCursor({ line, character: column })

    );

    // Find command by traversing up
    let lastCommand: SyntaxNode | null = lastNode;
    while (lastCommand && !isCommand(lastCommand)) {
      if (lastCommand.isMissing && lastCommand.previousSibling) {
        lastCommand = lastCommand.previousSibling;
        continue;
      }
      lastCommand = lastCommand?.parent;
    }

    const commandNode = lastCommand;

    // Handle multi-line arguments
    const argumentIndex = commandNode ?
      this.getArgumentIndexWithEscapes(cached.document, commandNode, point) : 0;

    // Check for trailing spaces or if cursor is after content
    const isLast = cached.document.getLine(line).slice(0, column + 1).match(/\s+$/) !== null
      || (lastNode.endPosition.row === line && lastNode.endPosition.column <= column - 1 ||
        line < lastNode.endPosition.row);

    const lineStr = cached.document.getLineBeforeCursor(
      Position.create(line, column)
    );

    const docTextBeforeCursor = cached.document.getTextBeforeCursor(
      Position.create(line, column)
    )

    const endsWithSpace = lineStr.endsWith(' ');
    const textBeforeCursorForNode = (node: SyntaxNode | null | undefined) => {
      if (!node) return '';
      if (node.endPosition.column < column) {
        return node.text.slice(0, column - node.endPosition.column);
      }
      return node.text

    }
    return {
      lastNode: lastNode,
      lastCommand: commandNode,
      isLastNode: isLast,
      word: this.cached.get(uri)?.root.descendantForPosition({ row: line, column })?.text || '',
      line: lineStr,
      docTextBeforeCursor: docTextBeforeCursor,
      endswithSpace: endsWithSpace,
      trailingSemi: docTextBeforeCursor.trimEnd().endsWith(';'),
      commandName: textBeforeCursorForNode(commandNode?.firstNamedChild) || '',
      argumentIndex,
    };
  }

  /**
   * Get argument index considering escaped newlines
   */
  private getArgumentIndexWithEscapes(
    doc: LspDocument,
    command: Parser.SyntaxNode,
    point: Point,
  ): number {
    // If cursor is before command name, return -1
    if (point.row < command.startPosition.row ||
      point.row === command.startPosition.row &&
      point.column < command.startPosition.column) {
      return -1;
    }

    // If cursor is within or right after command name, return 0
    const commandName = command.firstNamedChild;
    if (!commandName ||
      point.row < commandName.endPosition.row ||
      point.row === commandName.endPosition.row &&
      point.column <= commandName.endPosition.column) {
      return 0;
    }

    // Start counting from 1 (after command name)
    let index = 1;

    // Examine each child after command name
    for (let i = 1; i < command.children.length; i++) {
      const child = command.children[i];
      if (!child) continue;

      // If cursor is before this child's end, we found our position
      if (point.row < child.endPosition.row ||
        point.row === child.endPosition.row &&
        point.column <= child.endPosition.column) {
        break;
      }
      index++;
    }

    return index;
  }

  /**
  * getSignatureInformation - looks through the symbols for functions that can be used
  * to create SignatureInfo objects to be used in the server. Only function SymbolKind's
  * will be used.
  */
  // getSignatureInformation() {}

  /**
  * getWorkspaceSymbols - looks up a query symbol in the entire cachedDocuments object.
  * An empty query will return all symbols in the current workspace.
  */
  getWorkspaceSymbols(query: string = ''): LSP.WorkspaceSymbol[] {
    const allSymbols = Array.from(this.workspaceSymbols.values()).flat().map(s => LSP.WorkspaceSymbol.create(s.name, s.kind, s.uri, s.range));
    if (query === '') {
      return allSymbols;
    }

    return allSymbols.filter(s => s.name.startsWith(query));
  }

  /**
   * updateUri - deletes an old Uri Entry, and updates
   */
}

/** gets any possible reference for the entire document */
export function getReferencesForEntireWorkspaceSymbols(
  document: LspDocument,
  analyzer: Analyzer,
): Map<FishSymbolHash, LSP.Location[]> {
  const results: Map<FishSymbolHash, LSP.Location[]> = new Map();

  const symbols = analyzer.analyze(document)?.symbols;

  flattenNested(...symbols).forEach((sym) => {
    const refLocations = analyzer.getReferences(document, sym.selectionRange.start);
    const key = sym.hash();
    if (!results.has(key)) results.set(key, []);
    const values = [...results.get(key)!, ...refLocations];
    results.set(key, values);
  });

  return results;
}

export namespace CursorAnalysis {
  export function create(
    lastNode: SyntaxNode | null,
    lastCommand: SyntaxNode | null,
    isLastNode: boolean,
    line: string,
    endswithSpace: boolean,
    commandName: string,
    word: string,
    argumentIndex: number,
  ): CursorAnalysis {
    return {
      line,
      lastNode,
      lastCommand,
      isLastNode,
      docTextBeforeCursor: '',
      endswithSpace,
      trailingSemi: false,
      word,
      commandName,
      argumentIndex,
    };
  }

  export function createEmpty(): CursorAnalysis {
    return {
      line: '',
      lastNode: null,
      lastCommand: null,
      isLastNode: false,
      docTextBeforeCursor: '',
      endswithSpace: false,
      trailingSemi: false,
      word: '',
      commandName: '',
      argumentIndex: 0,
    };
  }

  export function createWithDoc(line: string, docText: string): CursorAnalysis {
    return {
      line: line,
      lastNode: null,
      lastCommand: null,
      isLastNode: false,
      docTextBeforeCursor: docText,
      trailingSemi: docText.trimEnd().endsWith(';'),
      endswithSpace: line.endsWith(' '),
      word: '',
      commandName: '',
      argumentIndex: 0,
    };
  }
}

function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
  const equalRanges = (a: LSP.Range, b: LSP.Range) => {
    return (
      a.start.line === b.start.line &&
      a.end.line === b.end.line &&
      a.start.character === b.start.character &&
      a.end.character === b.end.character
    );
  };
  const matchingNames = nodes.filter(node => node.text === matchName);
  const uniqueRanges: LSP.Range[] = [];
  matchingNames.forEach(node => {
    const range = getRange(node);
    if (uniqueRanges.some(u => equalRanges(u, range))) {
      return;
    }
    uniqueRanges.push(range);
  });
  return uniqueRanges.map(range => Location.create(uri, range));
}

function symbolsScopeContainsPosition(symbols: FishSymbol[], name: string, position: Position) {
  const result: FishSymbol[] = [];
  for (const symbol of symbols) {
    if (symbol.name === name && symbol.isCallableAtPosition(position)) {
      // if (symbol.name === name && Locations.Range.containsPosition(symbol.range, position)) {
      result.push(symbol);
    }
  }
  return result;
}