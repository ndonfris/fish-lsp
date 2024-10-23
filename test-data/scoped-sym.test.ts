import Parser from 'web-tree-sitter';
import { buildScopedSym, logSyms } from '../src/enviornment/scoped-sym';
import { setLogger } from './logger-setup';
import { initializeParser } from '../src/parser';

describe('scopedSym', () => {
  setLogger();
  let parser: Parser;

  beforeEach(async () => {
    parser = await initializeParser();
  });

  it('t1', () => {
    const tree = parser.parse(`
set --local x

function foo
    argparse 'h/help' 'n/name' -- $argv
    or return

    echo inside foo: $argv
    echo inside foo: $x
    read --delimiter '=' --function a b c d e
    function inside_foo -a inside_foo_a inside_foo_b inside_foo_c inside_foo_d
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
end

set --global --export global_y_var 'y'

foo
`);
    /*
    /*
     * TODO - only semi working
     */
    const syms = buildScopedSym(tree.rootNode);
    // for (const sym of syms) {
    //   console.log({
    //     sym: sym.name,
    //   });
    // }
    logSyms(syms);
    expect(syms).toBeTruthy();
  });
});