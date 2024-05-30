import Parser, { SyntaxNode, Tree, Point } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { ExtendedBaseJson, PrebuiltDocumentationMap } from '../src/utils/snippets'
import * as NodeTypes from '../src/utils/node-types'
import * as TreeSitter from '../src/utils/tree-sitter'
import { getDefaultSignatures, regexStringSignature } from '../src/signature'
import {setLogger} from './helpers'
import { MarkupContent, SignatureHelp, SignatureInformation } from 'vscode-languageserver';

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

function lineSignatureBuilder(line: string, rootNode: SyntaxNode) : SignatureHelp | null {
  const pipeNames = PrebuiltDocumentationMap.getByType('pipe')
  const pipes: ExtendedBaseJson[] = []
  for (const node of TreeSitter.getChildNodes(rootNode)) {
    const pipe = pipeNames.find(p => p.name === node.text)
    if (!!pipe) {
      pipes.push(pipe)
    }
  }

  const varNode = TreeSitter.getChildNodes(rootNode).find(c => NodeTypes.isVariableDefinition(c));
  const allCmds = TreeSitter.getChildNodes(rootNode).filter(c => NodeTypes.isCommand(c));
  const regexOption = TreeSitter.getChildNodes(rootNode).find(n => NodeTypes.isMatchingOption(n, {shortOption: '-r', longOption: '--regex'}))
    
  if (line.startsWith('string') && !!regexOption) {
    return getDefaultSignatures() 

  }

  if (varNode && (line.startsWith('set') || line.startsWith('read')) && allCmds.pop()?.text === rootNode.text.trim()) {
    const output = getCurrentNodeType(varNode.text);
    if (!output) return null;
    return {
      signatures: [ buildSignature(output.name, output.description) ],
      activeSignature: 0,
      activeParameter: 0
    };
  }
  if (line.startsWith('return')) {
    const output = PrebuiltDocumentationMap.getByType('status');
    if (!output) return null;
    return {
      signatures: [ buildSignature(
        '$status',
        output.map((o: ExtendedBaseJson) => 
          `___${o.name}___ - _${o.description}_`
        ).join('\n')
      )],
      activeSignature: 0,
      activeParameter: 0
    }
  }
  if (pipes.length >= 1) {
    return {
      signatures: [ 
        ...pipes.map((o: ExtendedBaseJson) => buildSignature(o.name, `${o.name} - _${o.description}_`))
      ],
      activeSignature: 0,
      activeParameter: 0
    }
  }

  if (allCmds.length === 1) {
    const firstCmd = allCmds[0]!
    const output = PrebuiltDocumentationMap.getByType('command').filter(n => n.name === firstCmd.text)
    if (!output) return null;
    return {
      signatures: [ buildSignature(
        firstCmd.text,
        output.map((o: ExtendedBaseJson) => 
          `${o.name} - _${o.description}_`
        ).join('\n')
      )],
      activeSignature: 0,
      activeParameter: 0
    }
  }


  return null

}

describe('signature test-suite', () => {

  it('`variable` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('set -gx fish_lsp_enabled_handlers')
    const signature = lineSignatureBuilder(line, lineRootNode)!
    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('fish_lsp_enabled_handlers')
  })

  it('`function` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('fish_prompt ')
    const signature = lineSignatureBuilder(line, lineRootNode)!

    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('fish_prompt')
  })

  it('`pipes` signature from snippets/*.json', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('alias 2>> ')
    const signature = lineSignatureBuilder(line, lineRootNode)!

    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toBe('2>>')

  })

  it('`return $status` from snippets/*.json', () => {

    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('return ')
    const signature = lineSignatureBuilder(line, lineRootNode)!
    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures[0]!.label).toEqual('$status')
  })

  it('`string --regex _`', () => {
    const { line, lineRootNode, lineCurrentNode } = analyzerParseCurrentLine('if string match -re "^-.*" "$argv"')
    const currentCmd = NodeTypes.findParentCommand(lineCurrentNode)!
    
    // console.log(currentCmd.text)
    const signature = lineSignatureBuilder(currentCmd.text, currentCmd)!
    // console.log(JSON.stringify(signature, null, 2));
    expect(signature.signatures.length).toBe(2)
  })


  // it('`function NAME --argument-names a b`', () => {
  //
  // })
  //
  // it('`alias NAME`', () => {
  //
  // })

})


