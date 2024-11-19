import { Hover, MarkupContent, MarkupKind, Position, WorkspaceSymbol, Location } from 'vscode-languageserver';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { /* isPositionWithinRange, */ getChildNodes } from './utils/tree-sitter';
import { LspDocument } from './document';
import { /*isCommand,*/ isCommandName } from './utils/node-types';
import { pathToUri } from './utils/translation';
import { existsSync } from 'fs';
import homedir from 'os';
import { FishWorkspace } from './utils/workspace';
// import { /*flattenSymbols, */getFishDocumentSymbolItems, FishDocumentSymbol } from './utils/symbol';
// import { GenericTree } from './utils/generic-tree';
// import { findDefinitionSymbols } from './workspace-symbol';
import { config } from './cli';
import { FishSymbol, getScopedFishSymbols } from './utils/symbol';

export class Analyzer {
  protected parser: Parser;
  public workspaces: FishWorkspace[];

  constructor(parser: Parser, workspaces: FishWorkspace[] = []) {
    this.parser = parser;
    this.workspaces = workspaces;
  }

  public analyze(document: LspDocument): FishSymbol[] {
    this.parser.reset();
    const analyzedDocument = this.getAnalyzedDocument(
      this.parser,
      document,
    );
    // this.cache.setDocument(document.uri, analyzedDocument);
    // const symbols = this.cache.getDocumentSymbols(document.uri);
    // filterGlobalSymbols(symbols).forEach((symbol: FishDocumentSymbol) => {
    //   this.globalSymbols.add(symbol);
    // });
    // return this.cache.getDocumentSymbols(document.uri);
    const tree = this.parser.parse(document.getText());
    return getScopedFishSymbols(analyzedDocument.tree.rootNode, document.uri);
  }

  private getAnalyzedDocument(
    parser: Parser,
    document: LspDocument,
  ): AnalyzedDocument {
    const tree = parser.parse(document.getText());
    const documentSymbols = getScopedFishSymbols(
      tree.rootNode,
      document.uri,
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
    let amount = 0;
    const max_files = config.fish_lsp_max_background_files;

    for (const workspace of this.workspaces) {
      const docs = workspace
        .urisToLspDocuments()
        .filter((doc: LspDocument) => doc.shouldAnalyzeInBackground());

      for (const doc of docs) {
        if (amount >= max_files) {
          break;
        }
        try {
          this.analyze(doc);
          amount++;
        } catch (err) {
          console.error(err);
        }
      }
      if (amount >= max_files) {
        break;
      }
    }
    callbackfn(`[fish-lsp] analyzed ${amount} files`);
    return { filesParsed: amount };
  }

  public findDocumentSymbol(
    document: LspDocument,
    position: Position,
  ): FishSymbol | undefined {
    if (!document || !position) return undefined;
    // this.cache[document.uri].
    //
    // const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(document.uri, document.)
    return undefined;
  }

  /**
     * method that returns all the workspaceSymbols that are in the same scope as the given
     * shell
     * @returns {WorkspaceSymbol[]} array of all symbols
     */
  public getWorkspaceSymbols(query: string = ''): WorkspaceSymbol[] {
    if (query === '') return [];
    return [];
  }

  public getDefinition(
    document: LspDocument,
    position: Position,
  ): FishSymbol | null {
    if (!document || !position) return null;
    const symbols: FishSymbol[] = getScopedFishSymbols(this.parser.parse(document.getText()).rootNode, document.uri);
    if (symbols.length) {
      return symbols.pop() || null;
    }
    return null;
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
    const symbol = this.analyze(document).pop();
    // const symbol =
    // this.getDefinition(document, position) as FishDocumentSymbol ||
    // this.globalSymbols.findFirst(node.text);
    if (symbol) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: symbol.detail.toString(),
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

  getTree(documentUri: string) : Tree | undefined {
    if (!documentUri) return undefined;
    return undefined;
  }

  /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
  getRootNode(documentUri: string): SyntaxNode | undefined {
    if (!documentUri) return undefined;
    return undefined;
  }

  getDocument(documentUri: string): LspDocument | undefined {
    if (!documentUri) return undefined;
    return undefined;
  }

  getDocumentSymbols(documentUri: string): FishSymbol[] {
    if (!documentUri) return [];
    return [];
  }

  getFlatDocumentSymbols(documentUri: string): FishSymbol[] {
    if (!documentUri) return [];
    return [];
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
    //const linePreTrim: string = document.getLineBeforeCursor(position);
    //const line = linePreTrim.slice(0,linePreTrim.lastIndexOf('\n'));
    const line = document
      .getLineBeforeCursor(position)
      .replace(/^(.*)\n$/, '$1');
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
    const tree = this.getTree(uri);
    if (!tree || !tree?.rootNode) {
      // Check for lacking rootNode (due to failed parse?)
      return null;
    }
    return tree.rootNode.descendantForPosition({ row: line, column });
  }

  /**
     * Find the name of the command at the given point.
     */
  // public commandNameAtPoint(
  //   uri: string,
  //   line: number,
  //   column: number,
  // ): string | null {
  //
  // //   let node = this.nodeAtPoint(uri, line, column);
  // //
  // //   while (node && !isCommand(node)) {
  // //     node = node.parent;
  // //   }
  // //
  // //   if (!node) {
  // //     return null;
  // //   }
  // //
  // //   const firstChild = node.firstNamedChild;
  // //
  // //   if (!firstChild || !isCommandName(firstChild)) {
  // //     return null;
  // //   }
  // //
  // //   return firstChild.text.trim();
  // // }
  //   return null;
  // }

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

  public getExistingAutoloadedFiles(name: string): string[] {
    const searchNames = [
      `${homedir}/.config/functions/${name}.fish`,
      `${homedir}/.config/completions/${name}.fish`,
    ];
    return searchNames
      .filter((path) => existsSync(path))
      .map((path) => pathToUri(path));
  }
}
// export class GlobalDefinitionCache {
//   constructor(private _definitions: Map<string, FishDocumentSymbol[]> = new Map()) {}
//   add(symbol: FishDocumentSymbol): void {
//     const current = this._definitions.get(symbol.name) || [];
//     if (!current.some(s => FishDocumentSymbol.equal(s, symbol))) {
//       current.push(symbol);
//     }
//     this._definitions.set(symbol.name, current);
//   }
//   find(name: string): FishDocumentSymbol[] {
//     return this._definitions.get(name) || [];
//   }
//   findFirst(name: string): FishDocumentSymbol | undefined {
//     const symbols = this.find(name);
//     if (symbols.length === 0) {
//       return undefined;
//     }
//     return symbols[0];
//   }
//   has(name: string): boolean {
//     return this._definitions.has(name);
//   }
//   uniqueSymbols(): FishDocumentSymbol[] {
//     const unique: FishDocumentSymbol[] = [];
//     this.allNames.forEach(name => {
//       const u = this.findFirst(name);
//       if (u) {
//         unique.push(u);
//       }
//     });
//     return unique;
//   }
//   get allSymbols(): FishDocumentSymbol[] {
//     const all: FishDocumentSymbol[] = [];
//     for (const [_, symbols] of this._definitions.entries()) {
//       all.push(...symbols);
//     }
//     return all;
//   }
//   get allNames(): string[] {
//     return [...this._definitions.keys()];
//   }
//   get map(): Map<string, FishDocumentSymbol[]> {
//     return this._definitions;
//   }
// }

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

// export class AnalyzedDocumentCache {
//   constructor(private _documents: Map<URI, AnalyzedDocument> = new Map()) {}
//   uris(): string[] {
//     return [...this._documents.keys()];
//   }
//   setDocument(uri: URI, analyzedDocument: AnalyzedDocument): void {
//     this._documents.set(uri, analyzedDocument);
//   }
//   getDocument(uri: URI): AnalyzedDocument | undefined {
//     if (!this._documents.has(uri)) {
//       return undefined;
//     }
//     return this._documents.get(uri);
//   }
//   updateUri(oldUri: URI, newUri: URI): void {
//     const oldValue = this.getDocument(oldUri);
//     if (oldValue) {
//       this._documents.delete(oldUri);
//       this._documents.set(newUri, oldValue);
//     }
//   }
//   getDocumentSymbols(uri: URI): FishDocumentSymbol[] {
//     return this._documents.get(uri)?.documentSymbols || [];
//   }
//   // getFlatDocumentSymbols(uri: URI): FishDocumentSymbol[] {
//   //   return FishDocumentSymbol.flattenArray(this.getDocumentSymbols(uri));
//   // }
//   getCommands(uri: URI): string[] {
//     return this._documents.get(uri)?.commands || [];
//   }
//   getRootNode(uri: URI): Parser.SyntaxNode | undefined {
//     return this.getParsedTree(uri)?.rootNode;
//   }
//   getParsedTree(uri: URI): Parser.Tree | undefined {
//     return this._documents.get(uri)?.tree;
//   }
//   // getSymbolTree(uri: URI): GenericTree<FishDocumentSymbol> {
//   //   const document = this.getDocument(uri);
//   //   if (!document) {
//   //     return new GenericTree<FishDocumentSymbol>([]);
//   //   }
//   //   return new GenericTree<FishDocumentSymbol>(document.documentSymbols);
//   // }
//   /**
//      * Name is a string that will be searched across all symbols in cache. tree-sitter-fish
//      * type of symbols that will be searched is 'word' (i.e. variables, functions, commands)
//      * @param {string} name - string SyntaxNode.name to search in cache
//      * @returns {map<URI, SyntaxNode[]>} - map of URIs to SyntaxNodes that match the name
//      */
//   findMatchingNames(name: string): Map<URI, SyntaxNode[]> {
//     const matches = new Map<URI, SyntaxNode[]>();
//     this.forEach((uri, doc) => {
//       const root = doc.tree.rootNode;
//       const nodes = root.descendantsOfType('word').filter(node => node.text === name);
//       if (nodes.length > 0) {
//         matches.set(uri, nodes);
//       }
//     });
//     return matches;
//   }
//   forEach(callbackfn: (uri: URI, document: AnalyzedDocument) => void): void {
//     for (const [uri, document] of this._documents) {
//       callbackfn(uri, document);
//     }
//   }
//   filter(callbackfn: (uri: URI, document?: AnalyzedDocument) => boolean): AnalyzedDocument[] {
//     const result: AnalyzedDocument[] = [];
//     this.forEach((currentUri, currentDocument) => {
//       if (callbackfn(currentUri, currentDocument)) {
//         result.push(currentDocument);
//       }
//     });
//     return result;
//   }
//   mapUris<U>(callbackfn: (doc: AnalyzedDocument) => U, uris: URI[] = this.uris()): U[] {
//     const result: U[] = [];
//     for (const uri of uris) {
//       const doc = this.getDocument(uri);
//       if (!doc) {
//         continue;
//       }
//       result.push(callbackfn(doc));
//     }
//     return result;
//   }
// }
//
// export class SymbolCache {
//   constructor(
//     private _names: Set<string> = new Set(),
//     private _variables: Map<string, FishDocumentSymbol[]> = new Map(),
//     private _functions: Map<string, FishDocumentSymbol[]> = new Map(),
//   ) {}
//
//   add(symbol: FishDocumentSymbol): void {
//     const oldVars = this._variables.get(symbol.name) || [];
//     switch (symbol.kind) {
//       case SymbolKind.Variable:
//         this._variables.set(symbol.name, [...oldVars, symbol]);
//         break;
//       case SymbolKind.Function:
//         this._functions.set(symbol.name, [...oldVars, symbol]);
//         break;
//     }
//     this._names.add(symbol.name);
//   }
//
//   isVariable(name: string): boolean {
//     return this._variables.has(name);
//   }
//
//   isFunction(name: string): boolean {
//     return this._functions.has(name);
//   }
//
//   has(name: string): boolean {
//     return this._names.has(name);
//   }
// }