import Parser, { SyntaxNode, Tree, Point } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { ExtendedBaseJson, PrebuiltDocumentationMap } from '../src/utils/snippets'
import * as NodeTypes from '../src/utils/node-types'
import * as TreeSitter from '../src/utils/tree-sitter'
import { getDefaultSignatures, regexStringSignature } from '../src/signature'
import {setLogger} from './helpers'
import { MarkupContent, SignatureHelp, SignatureInformation } from 'vscode-languageserver';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { FishAliasCompletionItem } from '../src/utils/completion/types';
import { getDocumentationResolver } from '../src/utils/completion/documentation';

let parser: Parser;
// const documentationMap = PrebuiltDocumentationMap;

function analyzerParseCurrentLine(input: string) {
  const line = input.trim();
  const rootNode = parser.parse(line).rootNode
  const lastNode = rootNode.descendantForPosition({row: 0, column: line.length - 1})
  const wordAtPoint = rootNode.descendantForPosition({row: 0, column: Math.max(line.length - 1, 0)})
  return {
    line: input,
    word: wordAtPoint,
    lineRootNode: rootNode,
    lineCurrentNode: lastNode
  }
}

function getCurrentNodeType(input: string) {
  const prebuiltTypes = PrebuiltDocumentationMap.getByName(input)
  if (!prebuiltTypes || prebuiltTypes.length === 0) {
    return null
  }
  let longestDocs = prebuiltTypes[0]!
  for (const prebuilt of prebuiltTypes) {
    if (prebuilt.description.length > longestDocs.description.length) {
      longestDocs = prebuilt
    }
  }
  return longestDocs
}

function buildSignature(label: string, value: string) : SignatureInformation {
  return {
    label: label,
    documentation: {
      kind: 'markdown',
      value: value,
    },
  }
}

setLogger(
  async () => {
    parser = await initializeParser();
  },
  async () => {
    if (parser) parser.delete();
  }
)

function lineSignatureBuilder(lineRootNode: SyntaxNode, lineCurrentNode: SyntaxNode): SignatureHelp | null {
  const currentCmd = NodeTypes.findParentCommand(lineCurrentNode);
  const pipes = getPipes(lineRootNode);
  const varNode = getVariableNode(lineRootNode);
  const allCmds = getAllCommands(lineRootNode);
  const regexOption = getRegexOption(lineRootNode);

  if (!currentCmd && pipes.length === 1) return getPipesSignature(pipes);

  switch (true) {
    case currentCmd && isStringWithRegex(currentCmd.text, regexOption):
      return getDefaultSignatures();

    case varNode && isSetOrReadWithVarNode(currentCmd?.text || lineRootNode.text, varNode, lineRootNode, allCmds):
      return getSignatureForVariable(varNode);

    case currentCmd?.text.startsWith('return') || lineRootNode.text.startsWith('return'):
      return getReturnStatusSignature();

    // case currentCmd && 
    case currentCmd && allCmds.length === 1:
      return getCommandSignature(currentCmd);

    default:
      return null;
  }
}

function getPipes(rootNode: SyntaxNode): ExtendedBaseJson[] {
  const pipeNames = PrebuiltDocumentationMap.getByType('pipe');
  return TreeSitter.getChildNodes(rootNode).reduce((acc: ExtendedBaseJson[], node) => {
    const pipe = pipeNames.find(p => p.name === node.text);
    if (pipe) acc.push(pipe);
    return acc;
  }, []);
}

function getVariableNode(rootNode: SyntaxNode): SyntaxNode | undefined {
  return TreeSitter.getChildNodes(rootNode).find(c => NodeTypes.isVariableDefinition(c));
}

function getAllCommands(rootNode: SyntaxNode): SyntaxNode[] {
  return TreeSitter.getChildNodes(rootNode).filter(c => NodeTypes.isCommand(c));
}

function getRegexOption(rootNode: SyntaxNode): SyntaxNode | undefined {
  return TreeSitter.getChildNodes(rootNode).find(n => NodeTypes.isMatchingOption(n, { shortOption: '-r', longOption: '--regex' }));
}

function isStringWithRegex(line: string, regexOption: SyntaxNode | undefined): boolean {
  return line.startsWith('string') && !!regexOption;
}

function isSetOrReadWithVarNode(line: string, varNode: SyntaxNode | undefined, rootNode: SyntaxNode, allCmds: SyntaxNode[]): boolean {
  return !!varNode && (line.startsWith('set') || line.startsWith('read')) && allCmds.pop()?.text === rootNode.text.trim();
}

function getSignatureForVariable(varNode: SyntaxNode): SignatureHelp | null {
  const output = getCurrentNodeType(varNode.text);
  if (!output) return null;
  return {
    signatures: [buildSignature(output.name, output.description)],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getReturnStatusSignature(): SignatureHelp {
  const output = PrebuiltDocumentationMap.getByType('status').map((o: ExtendedBaseJson) => `___${o.name}___ - _${o.description}_`).join('\n')
  return {
    signatures: [buildSignature('$status', output)],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getPipesSignature(pipes: ExtendedBaseJson[]): SignatureHelp {
  return {
    signatures: pipes.map((o: ExtendedBaseJson) => buildSignature(o.name, `${o.name} - _${o.description}_`)),
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getCommandSignature(firstCmd: SyntaxNode): SignatureHelp  {
  const output = PrebuiltDocumentationMap.getByType('command').filter(n => n.name === firstCmd.text);
  return {
    signatures: [buildSignature(firstCmd.text, output.map((o: ExtendedBaseJson) => `${o.name} - _${o.description}_`).join('\n'))],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getAliasedCompletionItemSignature(item: FishAliasCompletionItem): SignatureHelp  {
  // const output = PrebuiltDocumentationMap.getByType('command').filter(n => n.name === firstCmd.text);
  return {
    signatures: [buildSignature(item.label, [
      '```fish',
      `${item.fishKind} ${item.label} ${item.detail}`,
      '```'
    ].join('\n'))],
    activeSignature: 0,
    activeParameter: 0,
  };
}
describe('signature test-suite', () => {

  it('`variable` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('set -gx fish_lsp_enabled_handlers')
    const signature = lineSignatureBuilder(lineRootNode, lineCurrentNode)!
    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('fish_lsp_enabled_handlers')
  })

  it('`function` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('fish_prompt ')
    const signature = lineSignatureBuilder(lineRootNode, lineCurrentNode)!

    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('fish_prompt')
  })

  it('`pipes` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('alias 2>> ')
    const signature = lineSignatureBuilder(lineRootNode, lineCurrentNode)!

    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('2>>')

  })

  it('`return $status` from snippets/*.json', () => {
    const { lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('return ');
    const signature = lineSignatureBuilder(lineRootNode, lineCurrentNode)!;
    console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toEqual('$status');
  })

  it('`string --regex _`', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('if string match -re "^-.*" "$argv"')
    const currentCmd = NodeTypes.findParentCommand(lineCurrentNode)!

    // console.log(currentCmd.text)
    const signature = lineSignatureBuilder(currentCmd, lineCurrentNode)!
    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures.length).toBe(2)
  })


  // it('`function NAME --argument-names a b`', async () => {
  //   const completionMap = await CompletionItemMap.initialize()
  //   const fn = completionMap.allOfKinds('function').find(f => f.label === 'popd_duplicates')!
  //   const documentation = await getDocumentationResolver(fn)
  //   const signature = buildSignature(fn.label, documentation.value)
  //   console.log(signature);
  // })
  
  it('`alias NAME`', async () => {
    const completionMap = await CompletionItemMap.initialize()
    const aliases = completionMap.allOfKinds('alias')
    console.log(JSON.stringify(getAliasedCompletionItemSignature(aliases.find(a => a.label === 'vimdiff')!), null, 2));
  })

   it('updates `activeSignature` and `activeParameter`', () => {
    const { lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('set -gx fish_lsp_enabled_handlers value1 value2');
    const signature = lineSignatureBuilder(lineRootNode, lineCurrentNode)!;
    signature.activeSignature = 1; // Focusing on the second signature if multiple
    signature.activeParameter = 2; // Focusing on the third parameter
    expect(signature.activeSignature).toBe(1);
    expect(signature.activeParameter).toBe(2);
  });

  it('does not show test command if set is the most recent', () => {
    const { lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('if test -n $argv; and set -q CMD_DURATION');
    const currentCmd = NodeTypes.findParentCommand(lineCurrentNode)!
    const signature = lineSignatureBuilder(currentCmd, lineCurrentNode)!;
    console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('CMD_DURATION'); // Expecting the `set` command signature
  });

})


