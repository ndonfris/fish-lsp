// import { processReadCommand, processArgparseCommand, processSetCommand, Sym, processFunctionArgumentVariables, processTree } from '../src/enviornment/symbol';
import { Scope, ScopeStack, Sym, processArgparseCommand, processFunctionArgumentVariables, processReadCommand, processSetCommand, processTree } from '../src/enviornment/symbol';
import * as Parser from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { setLogger } from './logger-setup';
import { getChildNodes } from '../src/utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { isScope } from '../src/utils/node-types';
// import { isOption } from '../src/utils/node-types';


describe('envSym', () => {
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

set global_y_var 'y'

foo
`);
    const results: Sym[] = [];
    const focusedNodes = tree.rootNode.descendantsOfType(['program', 'function_definition', 'command', 'for_loop']);

    for (const node of focusedNodes) {
      const firstNamedChild = node.firstNamedChild as Parser.SyntaxNode;
      switch (node.type) {
        case 'function_definition':
          results.push(Sym.create('function', firstNamedChild.text, firstNamedChild, node));
          results.push(...processFunctionArgumentVariables(node));
          break;
        case 'command':
          switch (firstNamedChild.text) {
            case 'set':
              results.push(processSetCommand(node));
              break;
            case 'read':
              results.push(...processReadCommand(node));
              break;
            case 'argparse':
              results.push(...processArgparseCommand(node));
              break;
            default:
              // results.push(Sym.create('command', node.text, node));
              break;
          }
          break;
        case 'program':
          results.push(Sym.create('program', 'ROOT', node));
          break;
      }
    }

    const scopes = tree.rootNode.descendantsOfType([
      // 'if_statement',
      // 'switch_statement',
      // 'for_statement',
      // 'while_statement',
      // 'begin_statement',
      'function_definition',
      'program',
    ]).map(node => {
      return new Scope(node, node.type === 'program' ? 'program' : 'function');
    });

    const scopeStack = new ScopeStack(scopes);
    scopeStack.print();
    // console.log(scopeStack.toString());

    // for (const node of scopes) {
    //   console.log({
    //     type: node.type,
    //     text: node.text,
    //   });
    // }

    for (const result of results) {
      const scope = scopeStack.findScope(result?.parent || result.node);
      console.log({
        name: result.name,
        kind: result.kind,
        scope: scope?.kind + ' ' + scope?.node.text.split('\n').at(0),
        // text: result.node.text,
      });
    }
    // console.table(results.map(r => {
    //   return {
    //     name: r.name,
    //     kind: r.kind,
    //     node: r.node.type + ' ' + r.node?.text.split(' ').at(0),
    //     parent: r.node.parent?.type + ' ' + r.node.parent?.text.split('\n').at(0),
    //   };
    // }), ['name', 'kind', 'node', 'parent']);
  });
});