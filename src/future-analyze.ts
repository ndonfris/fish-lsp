import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { LspDocument } from './document';
import { /*filterGlobalSymbols,*/ FishDocumentSymbol, getFishDocumentSymbolItems } from './utils/symbol';
import { getChildNodes } from './utils/tree-sitter';
import { isSourceFilename } from './diagnostics/node-types';
import { SyncFileHelper } from './utils/file-operations';

type AnalyzedDocument = {
  document: LspDocument;
  symbols: FishDocumentSymbol[];
  tree: Tree;
  root: SyntaxNode;
  nodes: SyntaxNode[];
  sourcedFiles: string[];
};

/**
 * REFACTORING ./analyze.ts
 * ONCE ./utils/workspace.ts IS COMPLETED!
 *
 * What is the goal here?
 *   - [ ] ./src/analyze.ts easier to test,
 *   - [ ] ./src/analyze.ts is clearer in scope && usage
 *   - [ ] ./src/analyze.ts is smaller and better structured
 *   - [ ] ./src/analyze.ts is extendable & maintainable
 */
export class Analysis { // @TODO rename to Analyzer
  public cachedDocuments: { [ uri: string ]: AnalyzedDocument; } = {};

  constructor(protected parser: Parser) {}

  private createAnalyzedDocument(document: LspDocument): AnalyzedDocument {
    const tree = this.parser.parse(document.getText());
    const root = tree.rootNode;
    const nodes = getChildNodes(root);
    const symbols = getFishDocumentSymbolItems(document.uri, tree.rootNode);
    const sourcedFiles = nodes
      .filter(isSourceFilename)
      .map(n => n.text);
    return {
      document,
      tree,
      root,
      nodes,
      symbols,
      sourcedFiles,
    };
  }

  analyze(document: LspDocument) {
    this.parser.reset();
    this.cachedDocuments[document.uri] = this.createAnalyzedDocument(document);
  }

  /**
   * A wrapper for this.analyze(). Creates an LspDocument from a filepath and analyzes it.
   * @returns LspDocument - the document analyzed
   */
  analyzeFilepath(filepath: string) {
    const document = SyncFileHelper.toLspDocument(filepath, 'fish', 1);
    this.analyze(document);
  }

  /**
   * call at startup to analyze in background
   */
  // async initalizeBackgroundAnalysis() {}

  /**
   * getDefinitionSymbol - get definition symbol in a LspDocument
   */
  // getDefinitionSymbol() {}

  /**
   * getReferenceSymbols - gets all references of a symbol in a LspDocument
   */
  // getReferenceSymbols() {}

  /**
   * getHover - gets the hover documentation of a symbol in a LspDocument
   */
  // getHover() {}

  /**
   * getCompletionSymbols - local symbols to send to a onCompletion request in server
   * @returns FishDocumentSymbol[]
   */
  // getCompletionSymbols() {}

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
  // getWorkspaceSymbols(query: string = '') {}

  /**
   * getFlatSymbols - flattened document symbol array. Helper function to be used
   * throughout this class.
   */
  // private getFlatSymbols() {}

  /**
   * updateUri - deletes an old Uri Entry, and updates
   */
}
