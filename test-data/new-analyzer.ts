import { SymbolKind, Location, Position, DocumentUri } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { equalRanges, getRange } from '../src/utils/tree-sitter';
import { FishDocumentSymbol, getFishDocumentSymbols, SymbolName } from '../src/utils/new-symbol';
import { Scope } from '../src/utils/new-scope';
import { flattenNested } from '../src/utils/flatten';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import '../src/utils/array';
import { SyncFileHelper } from '../src/utils/file-operations';
// import { isFunctionArgumentDefinitionNode } from '../src/utils/variable-syntax-nodes';
/**
 * type defs
 */

// interface TextSpan {
//   ranges: Range[];
// }

class NewAnalyzer {
  public uris: Set<DocumentUri> = new Set();
  public trees: Map<DocumentUri, Tree> = new Map();
  public localSymbols: Map<DocumentUri, FishDocumentSymbol[]> = new Map();
  public globalSymbols: Map<SymbolName, FishDocumentSymbol[]> = new Map();

  constructor(
    private parser: Parser,
  ) { }

  analyze(documentUri: DocumentUri, text: string) {
    // this.parser.reset();
    this.uris.add(documentUri);

    const tree = this.parser.parse(text);
    const symbols = getFishDocumentSymbols(documentUri, tree.rootNode);

    this.trees.set(documentUri, tree);
    this.localSymbols.set(documentUri, flattenNested(...symbols));
    this.addGlobalSymbols(flattenNested(...symbols));

    return symbols;
  }

  analyzeFile(filepath: string) {
    const document = SyncFileHelper.toLspDocument(filepath, 'fish', 0);
    return this.analyze(document.uri, document.getText());
  }

  private addGlobalSymbols(symbols: FishDocumentSymbol[]) {
    symbols
      .filter(s => s.scope.tagValue >= 3)
      .forEach(s => {
        const globalSymbols = this.globalSymbols.get(s.name) || [];
        globalSymbols.push(s);
        this.globalSymbols.set(s.name, globalSymbols);
      });
  }

  getUri(documentUri: string): DocumentUri | undefined {
    if (this.uris.has(documentUri) &&
      this.trees.has(documentUri) &&
      this.localSymbols.has(documentUri)) {
      return documentUri;
    }
    return undefined;
  }

  getNodeAt(documentUri: string, location: Position): SyntaxNode | null {
    const tree = this.trees.get(documentUri);

    if (!tree) return null;

    return tree.rootNode.descendantForPosition({
      row: location.line,
      column: location.character,
    });
  }

  getDefinition(documentUri: string, location: Position): FishDocumentSymbol | undefined {
    const node = this.getNodeAt(documentUri, location);

    if (!node) return undefined;

    const localSymbols = this.localSymbols.get(documentUri);
    if (!localSymbols) return undefined;

    const local = localSymbols
      .filter(s => s.name === node.text && s.scope.contains(node));

    if (local.length > 0) {
      return local.pop()!;
    }

    const global = this.globalSymbols.get(node.text);
    if (!global) return undefined;

    return global.pop()!;
  }

  getReferences(documentUri: string, location: Position): Location[] {
    const docUri = this.getUri(documentUri);
    if (!docUri) return [];

    const result: Location[] = [];

    const node = this.getNodeAt(documentUri, location);
    if (!node) return [];

    const defSym = this.getDefinition(documentUri, location);
    if (!defSym) return [];

    result.push(defSym.toLocation());

    if (defSym.scope.tagValue < Scope.getTagValue('global')) {
      const symbols = this.localSymbols.get(documentUri);
      if (!symbols) return [];

      for (const node of defSym.scope.getEncapsulatedNodes()) {
        if (node.text === defSym.name) {
          result.push(Location.create(documentUri, getRange(node)));
        }
      }
    }

    if (defSym.scope.tagValue >= Scope.getTagValue('global')) {
      for (const [uri, tree] of Array.from(this.trees.entries())) {
        const rootNode = tree.rootNode;
        const symbols: FishDocumentSymbol[] = this.localSymbols.get(uri)! as FishDocumentSymbol[];
        const scope = defSym.scope;
        // if (!symbols) continue;
        // const scope = getGlobalDocumentScope(rootNode, symbols, defSym.name);
        // scope.fixSpan(...flattenNested(...symbols));
        for (const node of scope.getEncapsulatedNodes()) {
          if (node.text === defSym.name && !result.some(loc => loc.uri === uri && equalRanges(loc.range, getRange(node)))) {
            result.push(Location.create(uri, getRange(node)));
          }
        }
      }
    }

    return result;
  }

  /**
   * ```typescript
   * console.log('localRefs', Array.from(localRefs.entries()).map(([k, v]) => {
   *   return { k, v: v.length };
   * }));
   * ```
   * ---
   * Get all local symbol references
   * ---
   * @param documentUri - The document uri
   * @returns A map of local symbol references
   */
  public getAllLocalSymbolReferences(documentUri: DocumentUri) {
    const result: Map<SymbolName, SyntaxNode[]> = new Map();
    const symbols = this.localSymbols.get(documentUri);
    if (!symbols) return result;

    for (const symbol of flattenNested(...symbols)) {
      if (symbol.scope.tagValue >= Scope.getTagValue('global')) continue;
      const nodesInScope = result.get(symbol.name) || [] as SyntaxNode[];
      nodesInScope.push(
        ...symbol.scope.getEncapsulatedNodes().filter(n => n.text === symbol.name),
      );
      result.set(symbol.name, nodesInScope);
    }
    return result;
  }
}

const main = async () => {
  const analyzer = new NewAnalyzer(await initializeParser());
  const uri = 'file:///home/user/.config/fish/config.fish';
  const text = `
set -gx foo_v a

function foo_f

    set -l foo_v 'foo_v inside foo_f'

    argparse h/help v/value 'x/extract' -- $argv
    or return

    function inner_f --inherit-variable foo_v
        echo new $foo_v
    end

    function inherit_f --no-scope-shadowing
      echo "\$argv: $argv"
      echo "\$foo_v: $foo_v"
    end

    inner_f
    inherit_f $argv

    function hidden_foo_v
      set -l foo_v 'foo_v inside hidden_foo_v'
    end

    function aaa --argument-names foo_v
        echo $a
    end
end
foo_f
`;
  const syms = analyzer.analyze(uri, text);

  flattenNested(...syms).filter(s => s.kind === SymbolKind.Variable)
    .forEach(s => {
      console.log(s.toString());
    });
  // const inner = flattenNested(...syms).filter(s => s.kind === SymbolKind.Function && s.name === 'inner_f');
  // getTextSpanRanges(inner[0]!.parent!.parent!).forEach((r, i) => {
  //   console.log('inner', i, r);
  // });
  let foo_v = flattenNested(...syms).filter(s => s.kind === SymbolKind.Variable && s.name === 'foo_v');

  foo_v.forEach(s => {
    console.log('----');
    console.log(s.toString());
    const scope = new Scope('file:///home/user/.config/fish/config.fish', s.currentNode, s.parentNode!, s);
    s.currentNode.parent?.childrenForFieldName('argument').forEach((arg, i) => {
      console.log({ arg: i, node: arg.text });
    });
    console.log({ tag: scope.tag });
    console.log('----');
  });

  foo_v = flattenNested(...syms).filter(s => s.kind === SymbolKind.Variable && s.name === 'foo_v');
  const global_foo_v = foo_v.at(0)!;
  const local_foo_v = foo_v.at(1)!;
  const inherit_foo_v = foo_v.at(2)!;
  const hidden_foo_v = foo_v.at(3)!;
  const last_foo_v = foo_v.at(-1)!;
  // console.log('last_foo_v');
  // flattenNested(...syms).filter(s => s.kind === SymbolKind.Function).forEach(s => {
  //   console.log(s.toString());
  // });

  // const local_foo_v = flattenNested(...syms).filter(s => s.kind === SymbolKind.Variable && s.name === 'foo_v')
  //   .at(1)!;
  //
  console.log('global_foo_v', global_foo_v.toString());
  console.log('local_foo_v', local_foo_v.toString());
  console.log('inherit_foo_v', inherit_foo_v.toString());
  console.log('hidden_foo_v', hidden_foo_v.toString());
  console.log('last_foo_v', last_foo_v.toString());

  // if (global_foo_v.scope.containsInTextSpan(local_foo_v.selectionRange)) {
  //   console.log('global_foo_v CONTAINS local_foo_v');
  // } else {
  //   console.log('global_foo_v DOES NOT CONTAIN local_foo_v');
  // }

  // console.table([
  //   checkSymbolScopeContainsRange('global_foo_v', 'local_foo_v', global_foo_v, local_foo_v),
  //   checkSymbolScopeContainsRange('local_foo_v', 'inherit_foo_v', local_foo_v, inherit_foo_v),
  //   checkSymbolScopeContainsRange('local_foo_v', 'last_foo_v', local_foo_v, last_foo_v),
  //   checkSymbolScopeContainsRange('inherit_foo_v', 'local_foo_v', inherit_foo_v, local_foo_v),
  //   checkSymbolScopeContainsRange('inherit_foo_v', 'hidden_foo_v', inherit_foo_v, hidden_foo_v),
  //   checkSymbolScopeContainsRange('local_foo_v', 'hidden_foo_v', local_foo_v, hidden_foo_v),
  // ], ['outer', 'inner', 'contains', 'outerScope', 'innerScope']);
  // for (const range of local_foo_v.scope.buildSpan().ranges) {
  //   console.log(range.start.line, range.start.character, range.end.line, range.end.character);
  // }

  analyzer.analyze(uri, text);
  analyzer.analyze('file:///home/user/.config/fish/functions/call_foo.fish', `
function call_foo
      foo_f
end
foo_f
`);
  analyzer.analyze(uri, text);

  // const def = analyzer.getDefinition(uri, { line: 3, character: 10 })!;
  // console.log({ def: def.toLocation() });
  // console.log({ def: def?.toString(), scope: def?.map(n => n.text) });
  // const refs = analyzer.getReferences(uri, { line: 3, character: 10 });
  // console.log({ refs });

  // type Ref = { ref: string; range: string; refNode: string; };
  // const result: Ref[] = [];

  // for (const ref of refs) {
  //   result.push({
  //     refNode: analyzer.getNodeAt(ref.uri, ref.range.start)?.text || '',
  //     ref: ref.uri,
  //     range: '(' + ref.range.start.line + ',' + ref.range.start.character + ':' + ref.range.end.line + ',' + ref.range.end.character + ')',
  //   });
  // }

  // result.forEach(r => {
  //   console.log(r);
  // });

  // const localRefs = analyzer.getAllLocalSymbolReferences(uri);
  // console.log('localRefs', Array.from(localRefs.entries()).map(([k, v]) => {
  //   return { k, v: v.length };
  // }));

  const symbols = analyzer.analyze(uri, text);
  for (const symbol of flattenNested(...symbols)) {
    if (symbol.kind === SymbolKind.Function) {
      console.log(symbol.toString());
    }
  }
  const newSymbols = analyzer.analyze('file:///home/user/.config/fish/functions/ret_foo.fish', ` 
function ret_foo --description 'returns foo'
    echo foo
    return $status
end

function __hidden_foo
    echo hidden foo
end`);

  for (const symbol of flattenNested(...newSymbols)) {
    if (symbol.kind === SymbolKind.Function) {
      console.log(symbol.toString());
    }
  }
};

main();
