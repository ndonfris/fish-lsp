import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  ClientCapabilities,
  Connection,
  Range,
  SymbolInformation,
  TextDocuments,
} from 'vscode-languageserver/node'
import { Tree } from 'web-tree-sitter'
import * as Parser from 'web-tree-sitter'
import { Documentation } from './documentation'
import { DependencyMap } from './dependencies'

type SymbolName = string
type Namespace = string

// Value is array because symbol with the same name can be defined globally and as a function parameter
export type SymbolsMap = Map<SymbolName, SymbolInformation[]>

export type NamespaceMap = Map<Namespace, Range>

export interface SymbolsByUri {
  [uri: string]: SymbolsMap
}

export interface TreesByUri {
  [uri: string]: Tree
}

export interface NamespacesByUri {
  [uri: string]: NamespaceMap
}

export interface CliOptions {
  noIndex: boolean
}

export interface Context {
  connection: Connection
  documents: TextDocuments<TextDocument>
  capabilities: ClientCapabilities
  parser: Parser
  trees: TreesByUri
  symbols: SymbolsByUri
  namespaces: NamespacesByUri
  dependencies: DependencyMap
  docs: Documentation
  cliOptions?: CliOptions
}
