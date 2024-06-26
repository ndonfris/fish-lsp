import os from 'os';
import { homedir } from 'os';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { findChildNodes, firstAncestorMatch, getChildNodes, getNodeAtRange } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, SymbolKind, TextDocumentItem } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { findSetDefinedVariable, isBlock, isCommand, isCommandName, isCommandWithName, isDefinition, isEnd, isFunctionDefinitionName, isIfOrElseIfConditional, isMatchingOption, isOption, isProgram, isScope, isStatement, isString, isVariable, isVariableDefinitionName } from '../src/utils/node-types';
// import { ScopeStack, isReference } from '../src/diagnostics/scope';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter } from '../src/diagnostics/node-types';

import { LspDocument } from '../src/document';
import { createFakeLspDocument, setLogger } from './helpers';
import { FishDocumentSymbol, filterLastPerScopeSymbol, findSymbolReferences, getFishDocumentSymbols } from '../src/document-symbol';
import { getDiagnostics } from '../src/diagnostics/validate';
let parser: Parser;
let diagnostics: Diagnostic[] = [];
let output: SyntaxNode[] = [];
let input: string = '';

setLogger(
  async () => {
    parser = await initializeParser(); diagnostics = []; input = ''; output = [];
  },
  async () => {
    parser.reset();
  },
);

function fishTextDocumentItem(uri: string, text: string): LspDocument {
  return new LspDocument({
    uri: `file://${homedir()}/.config/fish/${uri}`,
    languageId: 'fish',
    version: 1,
    text,
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

describe('diagnostics test suite', () => {
  it('NODE_TEST: test finding specific error nodes', async () => {
    const inputs: string[] = [
      [
        'echo "function error"',
        'function foo',
        '    if test -n $argv',
        '        echo "empty"',
        '     ',
        'end',
      ].join('\n'),
      [
        'echo "while error"',
        'while true',
        '     echo "is true"',
        '',
      ].join('\n'),
      ['echo \'\' error\'', 'string match \''].join('\n'),
      ['echo \'\" error\'', 'string match -r "'].join('\n'),
      ['echo "\(" error', 'echo ('].join('\n'),
      ['echo \'\$\( error\'', 'echo $('].join('\n'),
      ['echo \'\{ error\'', 'echo {a,b'].join('\n'),
      ['echo \'\[ error\'', 'echo $argv['].join('\n'),
      ['echo \'\[ error\'', 'echo "$argv["'].join('\n'),
      ['echo \'\$\( error\'', 'echo "$("'].join('\n'),
    ];
    const output: SyntaxNode[] = [];
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
      output.map(n => n.text),
    ).toEqual(
      ['function', 'while', '"', '(', '(', '{', '[', '[', '('],
    );
  });

  it('NODE_TEST: check for extra end', async () => {
    input = [
      'function foo',
      '    echo "hi" ',
      'end',
      'end',
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

  it('NODE_TEST: 0 indexed array', async () => {
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

  it('NODE_TEST: single quote includes variable expansion', async () => {
    input = 'echo \' $argv\'';
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

  it('NODE_TEST: isAlias definition', async () => {
    [
      'alias lst=\'ls --tree\'',
      'alias lst \'ls --tree\'',
      'alias lst "ls --tree"',
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

  it('NODE_TEST: universal definition in script', async () => {
    [
      'set -Ux uvar \'SOME VAR\'',
      'set --universal uvar \'SOME VAR\'',
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
      '--universal',
    ]);
  });

  it('NODE_TEST: find source file', () => {
    [
      'source file_does_not_exist.fish',
      'source',
      'command cat file_does_not_exist.fish | source',
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
    expect(output.map(o => o.text)).toEqual(['file_does_not_exist.fish']);
  });

  it('NODE_TEST: isTestCommandVariableExpansionWithoutString \'test -n/-z "$var"\'', () => {
    [
      'if test -n $arg0',
      'if test -z "$arg1"',
      '[ -n $argv[2] ]',
      '[ -z "$arg3" ]',
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
      '$argv[2]',
    ]);
  });

  it('NODE_TEST: silent flag', () => {
    const outputWithFlag: SyntaxNode[] = [];
    const outputWithoutFlag: SyntaxNode[] = [];
    [
      'if command -q ls;end',
      'if set -q argv; end',
      'if true; echo hi; else if string match -q; echo p; end',
      'if builtin -q set; end',
      'if functions -aq ls; end',
    ].forEach((input, index) => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isConditionalWithoutQuietCommand(node)) {
          outputWithFlag.push(node);
        }
      }
    });

    [
      'if command ls;end',
      'if set argv; end',
      'if true; echo hi; else if string match; echo p; end',
      'if builtin set; end',
      'if functions ls; end',
      ['if test -n "$argv"',
        '   echo yes',
        'else if test -z "$argv"',
        '     set -Ux variable a',
        'end',
      ].join('\n'),
    ].forEach((input, index) => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        // if (index === 5 && node.type === 'if_statement') {
        // console.log({node: node.toString()});
        // const condition = node.namedChildren.find(child => child.type === 'condition')
        // console.log('condi', node.childrenForFieldName('condition').map(c => c.text));
        // console.log(node.namedChildren.map(c => c.type + ':' + c.text ));
        // console.log({ text: condition?.text, type: condition?.type, gType: condition?.grammarType });
        // }
        // if (node.type === 'condition') {
        // }
        if (isConditionalWithoutQuietCommand(node)) {
          outputWithoutFlag.push(node);
        }
      }
    });
    expect(outputWithFlag.length).toBe(0);
    expect(outputWithoutFlag.length).toBe(5);
  });

  it('NODE_TEST: `if set -q var_name` vs `if set -q $var_name`', () => {
    [
      'if set -q $variable_1; echo bad; end',
      'if set -q variable_2; echo good; end',
      'set $variable_3 (echo "a b c d e f $argv[2]") ',
      'set $variable_4 $PATH',
    ].forEach(input => {
      const { rootNode } = parser.parse(input);
      for (const node of getChildNodes(rootNode)) {
        if (isVariableDefinitionWithExpansionCharacter(node)) {
          // console.log({ type: node.type, text: node.text, p: node.parent?.text || 'null' });
          output.push(node);
        }
      }
    });

    expect(output.map(o => o.text)).toEqual([
      '$variable_1',
      '$variable_3',
      '$variable_4',
    ]);
  });

  /**
   * TODO:
   *     Improve references usage for autoloaded functions, and other scopes
   */
  it('NODE_TEST: unused local definition', () => {
    const definitions: SyntaxNode[] = [];
    [
      [
        '# input 1',
        'function foo',
        '    echo "inside foo" ',
        'end',
      ],
      [
        '# input 2',
        'set --local variable_1 a',
        'set --local variable_2 b',
        'set --global variable_3 c',
      ],
    ].map(innerArr => innerArr.join('\n')).forEach(input => {
      const tree = parser.parse(input);
      const root = tree.rootNode;
      for (const node of getChildNodes(root)) {
        if (isDefinition(node)) {
          if (isVariableDefinitionName(node)) {
            const parent = node.parent!;
            const isGlobal = findChildNodes(parent, n => {
              return isMatchingOption(n, { shortOption: '-U', longOption: '--universal' })
                || isMatchingOption(n, { shortOption: '-g', longOption: '--global' });
            });
            if (isGlobal.length === 0) {
              definitions.push(node);
              // console.log({ text: node.text, type: node.type });
            }
          } else {
            // console.log({ text: node.text, type: node.type });
            definitions.push(node);
          }
        }
      }
    });
    expect(definitions.map(d => d.text)).toEqual([
      'foo',
      'variable_1',
      'variable_2',
    ]);
  });

  it('VALIDATE: missing end', () => {
    [
      'echo "',
      'echo \'',
      'echo {a,b,c',
      'echo $argv[',
      'echo (',
      'echo $(',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: extra end', () => {
    [
      'for i in (seq 1 10); end; end',
      'function foo; echo hi; end; end',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: zero index', () => {
    [
      'echo $argv[0]',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isSingleQuoteVariableExpansion', () => {
    [
      'echo \'$argv[1]\'; echo \'\\$argv[1]\'',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isAlias', () => {
    [
      'alias fo=\'fish_opt\'',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const doc = createFakeLspDocument(`file:///tmp/test-${idx}.fish`, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isUniversal', () => {
    [
      'set -U _foo abcdef',
      'set -U _foo abcdef',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const result = getDiagnostics(rootNode, doc);
      if (idx === 0) {
        expect(result.length).toBe(1);
      } else if (idx === 1) {
        expect(result.length).toBe(0);
      }
    });
  });

  it('VALIDATE: sourceFilename', () => {
    [
      'source ~/.config/fish/__cconfig.fish',
      'source (get-fish-config-file)',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const result = getDiagnostics(rootNode, doc);
      if (idx === 0) {
        expect(result.length).toBe(1);
      } else if (idx === 1) {
        expect(result.length).toBe(0);
      }
    });
  });

  it('VALIDATE: isTestCommandVariableExpansionWithoutString', () => {
    [
      'test -n $argv',
      '[ -n $argv ]',
      '[ -z $argv[1] ]',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isConditionalWithoutQuietCommand', () => {
    [
      'if string match -r \'a\' "$argv";end;',
      'if set var;end;',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  it('VALIDATE: isVariableDefinitionWithExpansionCharacter', () => {
    [
      'set $argv a b c',
      'set $argv[1] a b c',
    ].forEach((input, idx) => {
      const { rootNode } = parser.parse(input);
      const uri = idx === 1 ? `file://${os.homedir()}/.config/fish/conf.d/test-1.fish` : `file:///tmp/test-${idx}.fish`;
      const doc = createFakeLspDocument(uri, input);
      const result = getDiagnostics(rootNode, doc);
      expect(result.length).toBe(1);
    });
  });

  // expect(definitions.map(d => d.text)).toEqual([
  //   'foo',
  //   'variable_1',
  //   'variable_2'
  // ]);

  /**
   * TODO:
   *      write argparse handler
   */
  // it('NODE_TEST: argparse', () => {
  //
  //
  //
  // })
});
