import * as LSP from 'vscode-languageserver';
import { SymbolKind, Range, Location } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { setLogger } from './logger-setup';
import { initializeParser } from '../src/parser';
import * as Locations from '../src/utils/locations';
import { flattenNested } from '../src/utils/flatten';
import { buildScopedSymbol, FishSymbol } from '../src/utils/symbol';
import { getCallableRanges, getCallableRanges2, rangesToNodes, removeRange } from './scope';

type HashSyntaxNodeKey = `${LSP.DocumentUri} ${SyntaxNode['id']} ${string}`;
const HashSyntaxNode = (uri: LSP.DocumentUri, parentNode: SyntaxNode, node: SyntaxNode): HashSyntaxNodeKey => `${uri} ${parentNode.id} ${node.text}`;

export function logFishsymbols(syms: FishSymbol[], indent: string = '') {
  const symbolKindStr = (s: FishSymbol | null) => s.kind === SymbolKind.Null ? '' : s.kind === SymbolKind.Variable ? '' : 'ƒ';
  const getNameKindStr = (s: FishSymbol | null) => `${symbolKindStr(s)} ${s?.name.trim() || 'root'}`;
  const getNodeStr = (n: SyntaxNode | null) => `${n?.type || 'null'} | ${n?.text.split('\n').at(0)?.slice(0, 15) || 'null'}`;
  for (const s of syms) {
    const strMain = new String(indent + getNameKindStr(s)).padEnd(25);
    const strParent = getNameKindStr(s.parent).padEnd(15);
    const modifier = s.modifier.padEnd(10);
    const strRange = Locations.Range.toString(s.range).padEnd(15, ' ') + Locations.Range.toString(s.selectionRange).padEnd(15);
    // const strNode = getNodeStr(s.node).padEnd(40, '.');
    // const strParentNode = getNodeStr(s.parentNode).padEnd(15);
    // eslint-disable-next-line no-console
    console.log(strMain + strParent + modifier + strRange);
    // console.log(strMain + strParent + modifier + strRange + strNode + strParentNode);
    // console.log(strMain + modifier + strRange + strNode + strParentNode);
    logFishsymbols(s.children, indent + ' '.repeat(4));
  }
}

function buildUniqueMapOfSymbols(symbols: FishSymbol[]): Map<string, FishSymbol[]> {
  const resultMap: Map<string, FishSymbol[]> = new Map<string, FishSymbol[]>();
  for (const symbol of symbols) {
    const key = HashSyntaxNode(symbol.uri, symbol.getParentScope(), symbol.node);
    if (!resultMap.has(key)) resultMap.set(key, []);
    resultMap.get(key)?.push(symbol);
  }
  return resultMap;
}

function logNode(node: SyntaxNode) {
  const rangeStr = Locations.Range.fromNodeToString(node);
  // const parent = findParentNonNull(node, (n) => isType(n, 'command', 'function_definition', 'for_statement', 'program'))!;
  // if (parent) {
  //   console.log(node.type, '|', node.text, '|', rangeStr, '|', parent?.type, '|', parent?.text);
  //   return;
  // }
  console.log(node.type, '|', node.text, '|', rangeStr);
}

function findReferences(root: SyntaxNode, symbols: FishSymbol[]) {
  const symbolIsGlobal = (symbol: FishSymbol, node: SyntaxNode) => {
    if (symbol.isGlobalScope()) return true;
    if (symbol.isLocalScope()) return !node.equals(symbol.node);
  };
  for (const symbol of symbols) {
    const searchableRanges = symbol.getLocalCallableRanges();
    const references: SyntaxNode[] = rangesToNodes(searchableRanges, root)
      .filter(n => n.text === symbol.name);
    // .filter(n => n.type === 'word'
    //   // && n.isNamed
    //   && n.text === symbol.name
    //   // && symbolIsGlobal(symbol, n)
    //   && !n.equals(symbol.node),
    // );
    console.log(symbol.name, references.length);
    // if (symbol.name === 'foo') {
    //   searchableRanges.forEach((r) => {
    //     console.log('l', Locations.Range.toString(r));
    //   });
    //   rangesToNodes(searchableRanges, root).forEach(n => logNode(n));
    // if (symbol.name === 'bool_1') {
    //   references.forEach(n => logNode(n));
    // }
    // }
  }
}

describe('symbol test suite', () => {
  setLogger();

  let parser: Parser;

  beforeEach(async () => {
    parser = await initializeParser();
  });

  it('test_1', () => {
    const tree = parser.parse(`
set --local x

function foo
    argparse 'h/help' 'n/name' -- $argv
    or return

    echo inside foo: $argv
    echo inside foo: $x
    read --delimiter '=' --function read_a read_b read_c read_d read_e
    function inside_foo -a inside_foo_a inside_foo_b inside_foo_c inside_foo_d \\
        --description 'this function is inside foo' \\
        --inherit-variable read_a
        echo inside inside_foo: $argv
        echo inside_foo_a: $inside_foo_a
        echo inside_foo_b: $inside_foo_b
        echo inside_foo_c: $inside_foo_c
        echo inside_foo_d: $inside_foo_d
    end

    inside_foo $foo_a $foo_b $foo_c $foo_d

    echo foo_a: $foo_a
    echo foo_b: $foo_b
    echo foo_c: $foo_c
    echo foo_d: $foo_d
end

function bar -a bar_a bar_b bar_c bar_d
    echo inside bar: $argv
    echo bar_a: $bar_a
    echo bar_b: $bar_b
    echo bar_c: $bar_c
    echo bar_d: $bar_d
    set --local bool_1 'neither 1'
    if true 
        set --local bool_1 'true 1'
    else
        set --local bool_1 'false 1'
    end
    echo bool_1: $bool_1
    function inside_bar_with_bool_1 --inherit-variable bool_1
        echo inside_bar_with_bool_1: $bool_1
    end
    inside_bar_with_bool_1

    function inside_bar_without_bool_1
        echo inside_bar_without_bool_1: $bool_1
    end
    inside_bar_without_bool_1
end

set --global --export global_y_var 'y'
echo a==b==c | read -d == -l a b c
echo d==e==f | read --delimiter '==' --function d e f
echo g==h==i | read --delimiter='==' --array g
echo 'j k l' | read --delimiter=' ' --array z

for i in (seq 1 10)
    echo $i
end

set i (math $i + 1);

foo
`);
    expect(tree.rootNode).not.toBeNull();
    const root = tree.rootNode;
    const uri = 'file:///home/user/.config/fish/config.fish';
    const symbols = buildScopedSymbol(tree.rootNode, uri);
    // logFishsymbols(symbols);

    // for (const symbol of flattenNested(...symbols)) {
    //   console.log(symbol.name);
    // }
    const foo = flattenNested(...symbols).find(s => s.name === 'foo');
    expect(foo).not.toBeNull();
    expect(foo?.functionInfo).not.toBeNull();
    // TODO: do something with foo since its refs count is 2
    //       `bar` is zero

    const inside_foo = flattenNested(...symbols).find(s => s.name === 'inside_foo');
    expect(inside_foo).not.toBeNull();
    expect(inside_foo?.functionInfo).not.toBeNull();
    expect(inside_foo?.functionInfo?.isAutoLoad).toBeFalsy();
    // console.log('printing functionInfo "inside_foo"');
    // if (inside_foo) {
    //   console.log(inside_foo.functionInfo);
    // }
    const bar = flattenNested(...symbols).find(s => s.name === 'bar');
    expect(bar).not.toBeNull();
    expect(bar?.functionInfo).not.toBeNull();
    expect(bar?.functionInfo?.isAutoLoad).toBeTruthy();
    // console.log('printing functionInfo "bar"');
    // if (bar) {
    //   console.log(bar.functionInfo);
    // }
    // const all_bools = flattenNested(...symbols).filter(s => s.name === 'bool_1');
    const resultMap = buildUniqueMapOfSymbols(flattenNested(...symbols));
    const uniqSymbols: FishSymbol[] = [];
    resultMap.forEach((value, _) => {
      uniqSymbols.push(value.at(0));
      // console.log(value.at(0).name);
    });
    findReferences(root, uniqSymbols);
    // const scopes = uniqueNodes(all_bools.map(bool => bool.getParentScope()));
    // const foo = flattenNested(...symbols).find(s => s.name === 'foo')!;
    // console.log('foo', foo, foo.functionInfo, { start: foo.parent.range.start, end: foo.parent.range.end });
    // let i = 0;
    // get Ranges with the foo range removed
    // const ranges = removeRange([foo.parent.range], foo.range);
    // console.log();
    // for (const r of ranges) {
    //   console.log(
    //     '"foo"',
    //     `range ${i}: `,
    //     r.start.line,
    //     r.start.character,
    //     r.end.line,
    //     r.end.character,
    //   );
    //   i++;
    // }
    // console.log();
    // loop over the ranges for Nodes
    // for (const n of rangesToNodes(ranges, root)) {
    //   if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
    //   console.log(n.type, n.text.trim());
    // }
    //
    const bool = flattenNested(...symbols).find(s => s.name === 'bool_1')!;
    const bools: SyntaxNode[] = [];
    // console.log('bool', bool.name);
    const bool_ranges = getCallableRanges(bool);
    for (const n of rangesToNodes(bool_ranges, root)) {
      if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
      if (n.text === 'bool_1') bools.push(n);
      //   if (n.text === 'bool_1') {
      //     const range = Locations.Range.fromNode(n);
      //     console.log(
      //       n.type,
      //       n.text.trim(),
      //       '|',
      //       range.start.line,
      //       range.start.character,
      //       range.end.line,
      //       range.end.character,
      //     );
      //   }
    }
    expect(bools.length).toBe(4);
    for (const b of bools) {
      console.log(b.text, b.type, Locations.Range.fromNodeToString(b));
    }
    // console.log('bool_ranges', bool_ranges.length);
    const inside_foo_refs: SyntaxNode[] = [];
    const inside_foo_ranges = getCallableRanges(inside_foo);
    for (const n of rangesToNodes(inside_foo_ranges, root)) {
      if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
      // if (n.text === 'inside_foo') logNode(n);
      if (n.text === 'inside_foo') inside_foo_refs.push(n);
    }
    expect(inside_foo_refs.length).toBe(1);

    // findReferences(root, flattenNested(...symbols));
  });

  it('process for loop', () => {
    const tree = parser.parse(`
for i in (seq 1 10)
    echo $i
end`,
    );
    const root = tree.rootNode;
    const for_loop = root.descendantsOfType('for_statement').pop();
    if (!for_loop) fail();
    // console.log(for_loop.text, for_loop.type, for_loop.toString());
    expect(for_loop).not.toBeNull();
    expect(for_loop.firstNamedChild.text).toBe('i');
    expect(for_loop.firstNamedChild.type).toBe('variable_name');
    // console.log('fnc', for_loop?.firstNamedChild?.text, for_loop?.firstNamedChild?.type);
  });
});