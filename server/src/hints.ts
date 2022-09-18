import { SyntaxNode } from 'web-tree-sitter'
import { Description, Documentation, dropParamList, Title } from './documentation'
import { getFunctionSignature, getPrecedingComments } from './utils'
import { basename } from 'path'

let builtinHints: Record<Title, Description>

function formatHint(title: string, description: string): string {
  return '```\n' + title + '\n```\n\n' + description + '\n\n'
}

function formatDocItem(docSection: Record<Title, Description>, title: Title): string {
  return formatHint(title, docSection[title].replace(/\\n/g, '\n\n'))
}

export function getBuiltinHints(docs: Documentation): Record<Title, Description> {
  if (builtinHints) return builtinHints

  const builtins_section: Record<Title, Description> = {}
  const functions: Record<Title, Description> = {}
  const io_statements: Record<Title, Description> = {
    // These have many special cases
    getline: '',
    print: '',
    printf: '',
  }
  const patterns: Record<Title, Description> = {}

  for (const title of Object.keys(docs.builtins)) {
    builtins_section[title] = formatDocItem(docs.builtins, title)
  }

  for (const title of Object.keys(docs.functions)) {
    functions[dropParamList(title)] = formatDocItem(docs.functions, title)
  }

  for (const title of Object.keys(docs.io_statements)) {
    if (title.includes('(')) {
      io_statements[dropParamList(title)] = formatHint(title, docs.io_statements[title])
    } else if (title.includes('getline')) {
      io_statements['getline'] += formatHint(title, docs.io_statements[title])
    } else if (title.includes('printf')) {
      io_statements['printf'] += formatHint(title, docs.io_statements[title])
    } else if (title.includes('print')) {
      io_statements['print'] += formatHint(title, docs.io_statements[title])
    } else {
      io_statements[title] = docs.io_statements[title]
    }
  }

  for (const title of Object.keys(docs.patterns)) {
    builtins_section[title] = formatDocItem(docs.patterns, title)
  }

  builtinHints = {
    ...builtins_section,
    ...functions,
    ...io_statements,
    ...patterns,
  }

  return builtinHints
}

export function getFunctionHint(funcDefinitionNode: SyntaxNode): string {
  const signature = getFunctionSignature(funcDefinitionNode)
  const precedingComments = getPrecedingComments(funcDefinitionNode)

  return formatHint(signature, precedingComments.replace(/\n/g, '\n\n'))
}

export function getVariableHint(definitionText: string, uri: string): string {
  const filename = basename(uri)

  return `Variable defined at [${filename}](${uri})\n\n` + formatHint(definitionText, '')
}
