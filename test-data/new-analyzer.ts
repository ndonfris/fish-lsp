/* eslint-disable comma-spacing */
/* eslint-disable no-multi-spaces */
import { SymbolKind, Location, Position, DocumentUri } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { getChildNodes, getRange } from '../src/utils/tree-sitter';
import { FishDocumentSymbol, getFishDocumentSymbols, SymbolName } from '../src/utils/new-symbol';
import { checkSymbolScopeContainsRange, getGlobalDocumentScope, getScope } from '../src/utils/scope';
import { flattenNested } from '../src/utils/flatten';
import * as Parser from 'web-tree-sitter';
import '../src/utils/array';
// import { isFunctionArgumentDefinitionNode } from '../src/utils/variable-syntax-nodes';
/**
 * type defs
 */

// interface TextSpan {
//   ranges: Range[];
// }

class NewAnalyzer {
  public trees: Map<DocumentUri, Parser.Tree> = new Map();
  private localSymbols: Map<DocumentUri, FishDocumentSymbol[]> = new Map();
  private globalSymbols: Map<SymbolName, FishDocumentSymbol[]> = new Map();

  constructor(
    private parser: Parser,
  ) { }

  analyze(documentUri: DocumentUri, text: string) {
    const tree = this.parser.parse(text);
    const symbols = getFishDocumentSymbols(documentUri, tree.rootNode);

    this.trees.set(documentUri, tree);
    this.localSymbols.set(documentUri, symbols);
    this.addGlobalSymbols(symbols);

    return symbols;
  }

  private addGlobalSymbols(symbols: FishDocumentSymbol[]) {
    flattenNested(...symbols)
      .filter(s => s.scope.tag === 'global')
      .forEach(s => {
        const globalSymbols = this.globalSymbols.get(s.name) || [];
        globalSymbols.push(s);
        this.globalSymbols.set(s.name, globalSymbols);
      });
  }

  getNodeAt(documentUri: string, location: Position): Parser.SyntaxNode | null {
    const tree = this.trees.get(documentUri);

    if (!tree) return null;

    return tree.rootNode.descendantForPosition({
      row: location.line,
      column: location.character,
    });
  }
}

const main = async () => {
  const analyzer = new NewAnalyzer(await initializeParser());
  const uri = 'file:///home/user/.config/fish/config.fish';
  const syms = analyzer.analyze(uri, `
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

    inherit_f $argv

    function hidden_foo_v
      set -l foo_v 'foo_v inside hidden_foo_v'
    end

    function aaa --argument-names foo_v
        echo $a
    end
end
`);

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
    const scope = getScope('file:///home/user/.config/fish/config.fish', s.node, s.node.text);
    s.node.parent?.childrenForFieldName('argument').forEach((arg, i) => {
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

  console.table([
    checkSymbolScopeContainsRange('global_foo_v',  'local_foo_v',    global_foo_v,   local_foo_v),
    checkSymbolScopeContainsRange('local_foo_v' ,  'inherit_foo_v',  local_foo_v,    inherit_foo_v),
    checkSymbolScopeContainsRange('local_foo_v' ,  'last_foo_v',     local_foo_v,    last_foo_v),
    checkSymbolScopeContainsRange('inherit_foo_v', 'local_foo_v',    inherit_foo_v,  local_foo_v),
    checkSymbolScopeContainsRange('inherit_foo_v', 'hidden_foo_v',   inherit_foo_v,  hidden_foo_v),
    checkSymbolScopeContainsRange('local_foo_v',   'hidden_foo_v',   local_foo_v,    hidden_foo_v),
  ], ['outer', 'inner', 'contains', 'outerScope', 'innerScope']);
  // for (const range of local_foo_v.scope.buildSpan().ranges) {
  //   console.log(range.start.line, range.start.character, range.end.line, range.end.character);
  // }

  const root = analyzer.trees.get(uri);

  flattenNested(...syms).filter(s => s.kind === SymbolKind.Function).forEach(s => {
    console.log(s.toString());
  });

  const scope = getGlobalDocumentScope(root!.rootNode, syms, 'foo_f');
  console.log(scope.toString());

  // if (last_foo_v.scope.containsInTextSpan(local_foo_v.node)) {
  //   console.log('last_foo_v contains local_foo_v');
  // }
  //
  // const inner_f = flattenNested(...syms).filter(s => s.kind === SymbolKind.Function && s.name === 'inner_f').pop()!;
  // console.log('inner_f', inner_f.toString());
  // const arg_foo_v = getChildNodes(inner_f.parent!).find((arg) => {
  //   return arg.text === 'foo_v';
  // })!;
  //
  // console.log('inner_f', inner_f.toString(), 'arg_foo_v', arg_foo_v.toString());
  //
  // const l = isFunctionArgumentDefinitionNode(inner_f.parent!, arg_foo_v);
  // console.log('l', l);
};

main();

// [
//   { id: 1, user: 'Alice', amount: 100 },
//   { id: 2, user: 'Bob', amount: 200 },
//   { id: 3, user: 'Alice', amount: 300 },
//   { id: 4, user: 'Charlie', amount: 150 },
//   { id: 5, user: 'Bob', amount: 250 },
// ].reverse().unique((t) => t.user).reverse().forEach(t => {
//   console.log(t);
// });
//
// // const items = [
// //   { name: 'a', kind: 'var', idx: 1 },
// //   { name: 'a', kind: 'var', idx: 2 },
// //   { name: 'b', kind: 'fun', idx: 3 },
// //   { name: 'a', kind: 'var', idx: 4 },
// //   { name: 'c', kind: 'var', idx: 5 },
// // ];
// //
// // const varResult = items.filterLastUnique(item => item.kind === 'var');
// // console.log(varResult);