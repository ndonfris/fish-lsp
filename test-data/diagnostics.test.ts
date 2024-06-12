import { homedir } from 'os';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { getChildNodes, getNodeAtRange } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, TextDocumentItem } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { isCommandWithName, isMatchingOption, isString } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { setLogger } from './helpers';
let parser: Parser;
let diagnostics: Diagnostic[] = [];
let output: SyntaxNode[] = [];
let input: string = '';

setLogger(
  async () => { parser = await initializeParser(); diagnostics = []; input = ''; output = []; },
  async () => { parser.reset(); }
);

function fishTextDocumentItem(uri: string, text: string): LspDocument {
  return new LspDocument({
    uri: `file://${homedir()}/.config/fish/${uri}`,
    languageId: 'fish',
    version: 1,
    text
  } as TextDocumentItem);
}

function severityStr(severity: DiagnosticSeverity | undefined) {
  switch (severity) {
    case DiagnosticSeverity.Error: return 'Error';
    case DiagnosticSeverity.Warning: return 'Warning';
    case DiagnosticSeverity.Information: return 'Information';
    case DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}

function logDiagnostics(diagnostic: Diagnostic, root: SyntaxNode) {
  console.log('-'.repeat(80));
  console.log(`entire text:     \n${root.text.slice(0, 20) + '...'}`);
  console.log(`diagnostic node: ${getNodeAtRange(root, diagnostic.range)?.text}`);
  console.log(`message:         ${diagnostic.message.toString()}`); // check uri for config.fish
  console.log(`severity:        ${severityStr(diagnostic.severity)}`); // check uri for config.fish
  console.log(`range:           ${JSON.stringify(diagnostic.range)}`); // check uri for config.fish
  console.log('-'.repeat(80));
}

function extractDiagnostics(tree: Tree) {
  const results: SyntaxNode[] = [];
  const cursor = tree.walk();
  const visitNode = (node: Parser.SyntaxNode) => {
    if (node.isError) {
      results.push(node);
    }
    for (const child of node.children) {
      visitNode(child);
    }
  };
  visitNode(tree.rootNode);
  return results;

}
type startTokenType = "function" | "while" | "if" | "for" | "begin" | "[" | "{" | "(" | "'" | '"';
type endTokenType = 'end' | "'" | '"' | ']' | '}' | ')';

const errorNodeTypes: { [ start in startTokenType ]: endTokenType } = {
  [ 'function' ]: 'end',
  [ 'while' ]: 'end',
  [ 'begin' ]: 'end',
  [ 'for' ]: 'end',
  [ 'if' ]: 'end',
  [ '"' ]: '"',
  [ "'" ]: "'",
  [ "{" ]: '}',
  [ "[" ]: ']',
  [ "(" ]: ')'
} as const;


function isStartTokenType(str: string): str is startTokenType {
  return [ 'function', 'while', 'if', 'for', 'begin', '[', '{', '(', "'", '"' ].includes(str);
}


function findErrorCause(children: Parser.SyntaxNode[]): Parser.SyntaxNode | null {
  const stack: Array<{ node: Parser.SyntaxNode, type: endTokenType; }> = [];

  for (const node of children) {
    if (isStartTokenType(node.type)) {
      const expectedEndToken = errorNodeTypes[ node.type ];
      const matchIndex = stack.findIndex(item => item.type === expectedEndToken);

      if (matchIndex !== -1) {
        stack.splice(matchIndex, 1); // Remove the matched end token
      } else {
        stack.push({ node, type: expectedEndToken }); // Push the current node and expected end token to the stack
      }
    } else if (Object.values(errorNodeTypes).includes(node.type as endTokenType)) {
      stack.push({ node, type: node.type as endTokenType }); // Track all end tokens
    }
  }

  // Return the first unmatched start token from the stack, if any
  return stack.length > 0 ? stack[ 0 ]?.node || null : null;
}


function isExtraEnd(node: SyntaxNode) {
  return node.type === 'command' && node.text === 'end';
}

function isZeroIndex(node: SyntaxNode) {
  return node.type === 'index' && node.text === '0';
}

function isSingleQuoteVariableExpansion(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'single_quote_string') {
    return false;
  }

  const variableRegex = /(?<!\\)\$\w+/; // Matches $variable, not preceded by a backslash
  return variableRegex.test(node.text);
}

function isAlias(node: SyntaxNode): boolean {
  return isCommandWithName(node, 'alias');
}

function isUniversalDefinition(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (isCommandWithName(parent, 'read') || isCommandWithName(parent, 'set')) {
    return isMatchingOption(node, { shortOption: '-U', longOption: '--universal' });
  }
  return false;
}

function isSourceFilename(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (isCommandWithName(parent, 'source') && parent.childCount === 2) {
    return parent.child(1)?.equals(node) || false;
  }
  return false;
}

function isTestCommandVariableExpansionWithoutString(node: SyntaxNode): boolean {
  const parent = node.parent;
  const previousSibling = node.previousSibling;
  if (!parent || !previousSibling) return false;

  if (!isCommandWithName(parent, 'test', '[')) return false;

  // console.log(parent.childCount, parent.text);
  // console.log({lastChildText: parent.child(2)?.text || 'unknown'});
  // console.log({text: node.text, type: node.type});
  // console.log('previousSibling', {text: previousSibling.text, type: previousSibling.type});
  if (isMatchingOption(previousSibling, { shortOption: '-n' }) || isMatchingOption(previousSibling, { shortOption: '-z' })) {
    return !isString(node) && !!parent.child(2) && parent.child(2)!.equals(node);
  }

  return false;
}

describe('diagnostics test suite', () => {

  it('test finding error nodes', async () => {
    let inputs: string[] = [
      [
        'echo "function error"',
        'function foo',
        '    if test -n $argv',
        '        echo "empty"',
        '     ',
        'end'
      ].join('\n'),
      [
        'echo "while error"',
        'while true',
        '     echo "is true"',
        ''
      ].join('\n'),
      [ `echo '\' error'`, `string match '` ].join('\n'),
      [ `echo '\" error'`, `string match -r "` ].join('\n'),
      [ 'echo "\(" error', 'echo (' ].join('\n'),
      [ `echo '\$\( error'`, `echo $(` ].join('\n'),
      [ `echo '\{ error'`, 'echo {a,b' ].join('\n'),
      [ `echo '\[ error'`, `echo $argv[` ].join('\n'),
      [ `echo '\[ error'`, `echo "$argv["` ].join('\n'),
      [ `echo '\$\( error'`, `echo "$("` ].join('\n')
    ];
    let output: SyntaxNode[] = [];
    inputs.forEach((input, index) => {
      const tree = parser.parse(input);
      const result = extractDiagnostics(tree).pop()!;
      for (const r of getChildNodes(result)) {
        if (!r.isError) continue;
        const errorNode = findErrorCause(r.children);
        // console.log(getChildNodes(r).map(n => n.text + ':::' + n.type))
        // if (errorNode) console.log('------\nerrorNode', errorNode.text);
        if (!errorNode) fail();
        output.push(errorNode);
      }
    });
    expect(
      output.map(n => n.text)
    ).toEqual(
      [ 'function', 'while', '"', '(', '(', '{', '[', '[', '(' ]
    );
  });

  it('check for extra end', async () => {
    input = [
      'function foo',
      '    echo "hi" ',
      'end',
      'end'
    ].join('\n');
    const tree = parser.parse(input);
    for (const node of getChildNodes(tree.rootNode)) {
      if (isExtraEnd(node)) {
        // console.log({type: node.type, text: node.text});
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('0 indexed array', async () => {
    input = 'echo $argv[0]';
    const { rootNode } = parser.parse(input);
    for (const node of getChildNodes(rootNode)) {
      if (isZeroIndex(node)) {
        // console.log({type: node.type, text: node.text});
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('single quote includes variable expansion', async () => {
    input = `echo ' $argv'`;
    const { rootNode } = parser.parse(input);
    for (const node of getChildNodes(rootNode)) {
      if (isSingleQuoteVariableExpansion(node)) {
        // console.log({type: node.type, text: node.text});
        // getChildNodes(node).forEach(n => console.log(n.text))
        output.push(node);
      }
    }
    expect(output.length).toBe(1);
  });

  it('isAlias definition', async () => {
    [
      `alias lst='ls --tree'`,
      `alias lst 'ls --tree'`,
      `alias lst "ls --tree"`,
    ].forEach(input => {
      output = [];
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        // console.log({type: node.type, text: node.text});
        if (isAlias(node)) {
          output.push(node);
        }
      }
      expect(output.length).toBe(1);
    });
  });


  it('universal definition in script', async () => {
    [
      `set -Ux uvar 'SOME VAR'`,
      `set --universal uvar 'SOME VAR'`,
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        // console.log({type: node.type, text: node.text});
        if (isUniversalDefinition(node)) {
          output.push(node);
        }
      }
    });
    expect(output.map(o => o.text)).toEqual([
      '-Ux',
      '--universal'
    ]);
  });

  it('find source file', () => {
    [
      `source file_does_not_exist.fish`,
      `source`,
      `command cat file_does_not_exist.fish | source`
    ].forEach(input => {

      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isSourceFilename(node)) {
          output.push(node);
          // console.log({ type: node.type, text: node.text });
        }
        // if (isCommandWithName(node, 'source')) {
        //   console.log('SOURCE', { type: node.type, text: node.text, children: node.childCount});
        //   const filename = node.lastChild;
        //   if (filename) console.log('FILENAME', { type: filename.type, text: filename.text });
        // }
      }
    });
    expect(output.map(o => o.text)).toEqual([ 'file_does_not_exist.fish' ]);
  });

  it(`isTestCommandVariableExpansionWithoutString 'test -n/-z "$var"'`, () => {
    [
      'if test -n $arg0',
      'if test -z "$arg1"',
      '[ -n $argv[2] ]',
      '[ -z "$arg3" ]'
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isTestCommandVariableExpansionWithoutString(node)) {
          // console.log({ type: node.type, text: node.text });
          output.push(node);
        }
      }
    });
    expect(output.map(o => o.text)).toEqual([
      '$arg0',
      '$argv[2]'
    ]);
  });

  // it('')

});

