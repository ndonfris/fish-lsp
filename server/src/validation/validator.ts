import { Diagnostic } from 'vscode-languageserver/node'
import { SyntaxNode } from 'web-tree-sitter'
import { DependencyMap } from '../dependencies'
import { Documentation } from '../documentation'
import { NamespacesByUri, SymbolsByUri } from '../interfaces'

export type ValidationContext = {
  node: SyntaxNode
  symbols: SymbolsByUri
  namespaces: NamespacesByUri
  dependencies: DependencyMap
  uri: string
  docs: Documentation
}

export type Validator = (validataionContext: ValidationContext) => Diagnostic | null
