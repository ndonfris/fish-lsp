import { homedir } from 'os';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { getChildNodes, getNodeAtRange, getNodesTextAsSingleLine, nodesGen } from '../src/utils/tree-sitter';
import { Diagnostic, DiagnosticSeverity, TextDocumentItem } from 'vscode-languageserver';
import { initializeParser } from '../src/parser';
import { getExtraEndSyntaxError, getMissingEndSyntaxError, getReturnSiblings, /* getUnreachableCodeSyntaxError */ } from '../src/diagnostics/syntaxError';
import { getUniversalVariableDiagnostics } from '../src/diagnostics/universalVariable';
import { createAllFunctionDiagnostics } from '../src/diagnostics/missingFunctionName';
import { collectDiagnosticsRecursive, collectFunctionNames, collectFunctionsScopes, getDiagnostics } from '../src/diagnostics/validate';
import { isCommand, isCommandName, isCommandWithName, isConditionalCommand, isFunctionDefinition, isFunctionDefinitionName, isMatchingOption, isReturn, isStatement, isString } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { setLogger, logNode, resolveLspDocumentForHelperTestFile } from './helpers';
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

// function findErrorCause(nodes: SyntaxNode[]) {
//   let result: SyntaxNode | null = null;
//   let found = false
//   let searchArr = nodes
//   while (!found && searchArr.length > 0) {
//     const currentNode = searchArr.shift() 
//     if (!currentNode) break;
//     const currentType = currentNode.type
//     if (isStartTokenType(currentType)) {
//       const resultType = errorNodeTypes[currentType]
//       const endToken = searchArr.find(n => n.type == resultType)
//       if (endToken) {
//         const endTokenIndex = searchArr.findIndex(n => n.type === resultType)
//         searchArr = searchArr.splice(endTokenIndex, 1)
//       } else {
//         found = true
//         result = currentNode
//       }
//     }
//   }
//   if (!!result) logNode(result)
// }

// function findErrorCause(children: Parser.SyntaxNode[]): Parser.SyntaxNode | null {
//   const stack: endTokenType[] = [];
//
//   for (const child of children) {
//     if (child.type in errorNodeTypes) {
//       const startToken = child.type as startTokenType;
//       const expectedEndToken = errorNodeTypes[startToken];
//
//       if (stack.length > 0 && stack[stack.length - 1] === expectedEndToken) {
//         stack.pop(); // Found the matching end token, remove it from stack
//       } else {
//         stack.push(expectedEndToken); // Push the expected end token to the stack
//       }
//     } else if (Object.values(errorNodeTypes).includes(child.type as endTokenType)) {
//       if (stack.length > 0 && stack[stack.length - 1] === child.type) {
//         stack.pop(); // Found the matching end token, remove it from stack
//       } else {
//         // Found an unmatched end token, this child is causing the error
//         return child;
//       }
//     }
//   }
//
//   // If there's still something in the stack, the last unmatched start token caused the error
//   if (stack.length > 0) {
//     for (const child of children) {
//       if (errorNodeTypes[child.type as startTokenType] === stack[0]) {
//         return child;
//       }
//     }
//   }
//
//   return null; // No specific error-causing child found
// }

// function findErrorCause(children: Parser.SyntaxNode[]): Parser.SyntaxNode | null {
//   const stack: endTokenType[] = [];
//
//   for (const node of children) {
//     if (isStartTokenType(node.type)) {
//       const expectedEndToken = errorNodeTypes[node.type];
//       const endTokenIndex = stack.lastIndexOf(expectedEndToken);
//       if (endTokenIndex === -1) {
//         return node;
//       } else {
//         stack.splice(endTokenIndex, 1);
//       }
//     } else if (Object.values(errorNodeTypes).includes(node.type as endTokenType)) {
//       stack.push(node.type as endTokenType);
//     }
//   }
//
//   return null;
// }


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

  // it('test missing end `if test -n $argv`', async () => {
  //   input = [ 'function foo', '    if test -n $argv', '    ', '    ', 'end' ].join('\n');
  //   const tree = parser.parse(input);
  //   const rootNode = tree.rootNode;
  //   for (const node of getChildNodes(rootNode)) {
  //     if (node.type === 'end') {
  //       console.log('test1');
  //       console.log(node.text);
  //     }
  //     // console.log(node.text, node.type, node.startPosition, node.endPosition);
  //     // if (isStatement(node)) {
  //     //   console.log('statement node: ', node.text);
  //     // }
  //   }
  //   // expect(diagnostics.map(d => d.code)).toEqual(['1'])
  // });


  // TODO
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
    ])
  });

  // it('')

});

// OLD TESTS

// describe('test diagnostics', () => {
//     it('test simple function diagnostics', async () => {
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             resolveLspDocumentForHelperTestFile(
//                 "fish_files/simple/func_a.fish",
//                 true
//             ),
//             resolveLspDocumentForHelperTestFile(
//                 "fish_files/simple/func_a.fish",
//                 false
//             ),
//         ];
//         docs.forEach((doc: LspDocument, index: number) => {
//             const root = parser.parse(doc.getText()).rootNode;
//             const diagnostics: Diagnostic[] = [];
//             const funcNames: string[] = []
//             getChildNodes(root).filter(isFunctionDefinitionName).forEach((node) => {
//                 if (collectFunctionNames(node, doc, diagnostics, funcNames)) {
//                     logNode(SHOULD_LOG, node);
//                 }
//             })
//             if (index === 0) expect(diagnostics).toHaveLength(4);
//             if (index === 1) expect(diagnostics).toHaveLength(1);
//         })
//     })
//
//
//     it('test universal variable', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tVARIABLES');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//              fishTextDocumentItem(`config.fish`,'set -U universal_var universal_value'),
//              fishTextDocumentItem(`functions/random_func.fish`, 'set -Ug universal_var universal_value'),
//              fishTextDocumentItem(`functions/other_func.fish`, 'for i in (seq 1 10);set -U universal_var universal_value;end'),
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             for (const node of nodesGen(root)) {
//                 const diagnostic = getUniversalVariableDiagnostics(node, doc);
//                 if (diagnostic) {
//                     if (SHOULD_LOG) logDiagnostics(diagnostic, root)
//                     diagnosticsErrors.push(diagnostic);
//                 }
//             }
//         })
//         expect(diagnosticsErrors.length).toBe(3);
//     })
//
//     it('test missing end', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tMISSING END BLOCKS');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             fishTextDocumentItem(`functions/pass_begin_block.fish`, 'begin; printf "hello "; printf "world\\n"; end'),                     // no diagnostics
//             fishTextDocumentItem(`functions/fail_begin_block.fish`, 'for i in (seq 1 10); printf "hello "; printf "world";'),              // missing end diagnostic
//             fishTextDocumentItem(`functions/fail_random_func.fish`, 'function fail_random_func; if test -z $argv; echo "match"; end;'),   // missing end diagnostic
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             for (const node of nodesGen(root)) {
//                 const d = getMissingEndSyntaxError(node)
//                 if (!d) continue;
//                 if (SHOULD_LOG) logDiagnostics(d, root)
//                 diagnosticsErrors.push(d);
//             }
//         })
//         expect(diagnosticsErrors.length).toBe(2);
//     })
//
//     it('test extra end', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tEXTRA END BLOCKS');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             fishTextDocumentItem(`functions/fail_extra_end.fish`,  'function fail_extra_end; if test -z $argv; echo "match"; end;end;end'),   // missing end diagnostic
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             for (const node of nodesGen(root)) {
//                 const d = getExtraEndSyntaxError(node);
//                 if (!d) continue;
//                 if (SHOULD_LOG) logDiagnostics(d, root)
//                 diagnosticsErrors.push(d);
//             }
//         })
//         expect(diagnosticsErrors.length).toBe(1);
//     })
//
//     it('test unreachable code', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tUNREACHABLE CODE');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = unreacableDocs()
//         const diagnosticsErrors: Diagnostic[] = [];
//         let root = parser.parse(docs[0].getText()).rootNode;
//         docs.forEach(doc => {
//             parser.reset()
//             root = parser.parse(doc.getText()).rootNode;
//             for (const node of nodesGen(root)) {
//                 const diagnostic = getUnreachableCodeSyntaxError(node);
//                 if (!diagnostic) continue;
//                 diagnosticsErrors.push(diagnostic);
//                 if (SHOULD_LOG) logDiagnostics(diagnostic, root)
//             }
//         })
//         expect(diagnosticsErrors.length).toBe(3);
//     })
//
//     it('test bad function name', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tURI FUNCTION NAME');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             fishTextDocumentItem(`functions/pass_func.fish`, 'function pass_func;begin; printf "hello "; printf "world\\n"; end;end;'),         // no diagnostics
//             fishTextDocumentItem(`functions/fail_func.fish`, 'function should_fail_func;begin; printf "hello "; printf "world\\n"; end;end;'),  // bad func name diagnostics
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             const diagnostics = createAllFunctionDiagnostics(root, doc);
//             if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
//             diagnosticsErrors.push(...diagnostics)
//         })
//         expect(diagnosticsErrors.length).toBe(1);
//     })
//
//     it('test duplicate function name', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tDUPLICATE FUNCTION NAME');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             fishTextDocumentItem(`functions/pass_func.fish`, 'function pass_func;begin; printf "hello "; printf "world\\n";end;end;'),         // no diagnostics
//             fishTextDocumentItem(`functions/duplicate_func.fish`, ['function should_fail_func;echo "hi";end;', 'function should_fail_func; echo "world"; end;'].join('\n')),  // bad func name diagnostics
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             const diagnostics = createAllFunctionDiagnostics(root, doc);
//             if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
//             diagnosticsErrors.push(...diagnostics);
//         })
//         expect(diagnosticsErrors.length).toBe(3);
//     })
//
//     
//
// const test_text =
// `function pass_func
//     if test 'a' = 'b'
//         for i in (seq 1 10)
//             echo $i
//         end
//         return 0;
//     end
//     return 1;
//     and echo "line 1"
//     and echo "line 2"
//     or  echo "line 3"
//     echo "outside of block"
// end
// `
//
// const test_command_chain_block_text =
// `function pass_func
//     if test 'a' = 'b'
//         for i in (seq 1 10)
//             echo $i
//         end
//         return 0;
//     end
//     echo "before block"
//     echo "start of block"
//     and echo "line 1"
//     or  echo "line 2"
//     and echo "line 3";
//     echo "outside of block 1"
//     echo "outside of block 2"
//     echo "outside of block 3"
// end
// `
//
//     it('return spans', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tVALIDATE');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             fishTextDocumentItem(`functions/pass_func.fish`, test_text),         // no diagnostics
//             fishTextDocumentItem(`functions/command_chain_func.fish`, test_command_chain_block_text),         // no diagnostics
//         ];
//         const diagnosticsErrors: Diagnostic[] = [];
//         docs.forEach(doc => {
//             parser.reset()
//             const root = parser.parse(doc.getText()).rootNode;
//             console.log(doc.uri)
//             for (const node of nodesGen(root)) {
//                 if (!node.isNamed()) continue;
//                 if (isReturn(node)) {
//                     //console.log('-'.repeat(50));
//                     let result : SyntaxNode[] = []
//                     let current: SyntaxNode | null = node
//                     let outOfRange = false;
//                     while (current) {
//                             console.log("current: " + getNodesTextAsSingleLine([current]))
//                             if (!outOfRange && isConditionalCommand(current)) {
//                                 current = current.nextNamedSibling;
//                                 continue;
//                             }
//                             if (!outOfRange && !isConditionalCommand(current)) {
//                                 result.push(current);
//                                 outOfRange = true;
//                             } else if (outOfRange) {
//                                 result.push(current);
//                                 outOfRange = true;
//                             }
//                             current = current.nextNamedSibling;
//                     }
//
//                     const logStr = `group: ${result}, chain_length: ${result.length}\n${getNodesTextAsSingleLine(result)}`
//
//                 }
//             }
//         })
//     })
//
//     it('validate', async () => {
//         SHOULD_LOG = false
//         if (SHOULD_LOG) console.log('\n\n\t\tVALIDATE');
//         const parser = await initializeParser();
//         const docs: LspDocument[] = [
//             //fishTextDocumentItem(`functions/pass_func.fish`, `function pass_func;set -U asdf 'g';end; function pass_func; echo $argv;end;`),         // no diagnostics
//             //fishTextDocumentItem(`functions/duplicate_func.fish`, ['function should_fail_func;echo "hi";end;', 'function should_fail_func; echo "world"; end;'].join('\n')),  // bad func name diagnostics
//            resolveLspDocumentForHelperTestFile('fish_files/simple/multiple_broken_scopes.fish') 
//         ];
//         const doc : LspDocument = resolveLspDocumentForHelperTestFile('fish_files/simple/multiple_broken_scopes.fish')
//         let diagnostics: Diagnostic[] = [];
//         parser.reset()
//         const funcDoc = convertToAutoloadDocument(doc)
//         const root = parser.parse(funcDoc.getText()).rootNode;
//         for (const node of nodesGen(root)) {
//             if (isFunctionDefinition(node)) {
//                 collectFunctionsScopes(node, funcDoc, diagnostics);
//             }
//         }
//         //const diagnostics = collectDiagnosticsRecursive(root, funcDoc);
//         if (SHOULD_LOG) diagnostics.forEach(d => logDiagnostics(d, root))
//         //diagnostics.push(...diagnostics);
//         //expect(diagnosticsErrors.length).toBe(5);
//     })
//
// })
//
//
//
// function convertToAutoloadDocument(doc: LspDocument) {
//     const funcDoc = new LspDocument({ uri: `file://${homedir()}/.config/fish/functions/multiple_broken_scopes.fish`, languageId: doc.languageId, version: doc.version, text: doc.getText()});
//     return funcDoc
// }
//
// function unreacableDocs() {
//     return [
//         fishTextDocumentItem(`functions/unreachable_code.fish`,  // early return  
//         'function unreachable_code; return true;if test -z $argv; echo "match"; end;end'),
//         fishTextDocumentItem(`functions/unreachable_code_1.fish`, // early return + multiple children
//         `function unreachable_code_1\n\treturn 0;\n\tif test -z $argv;\n\t\treturn true;\n\tend;\n\techo $argv;\nend`), 
//         fishTextDocumentItem(`functions/reachable_code.fish`, // conditional return so is reachable
//         'function reachable_code; echo $argv;and return true;if test -z $argv; echo "match"; end;end'),
//         fishTextDocumentItem(`functions/reachable_code.fish`, // conditional return so is reachable
//         `function reachable_code;if test -n $argv;return 0;end;return 1;end;`)
//     ]
// }


