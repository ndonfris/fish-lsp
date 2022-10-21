import {Analyzer, SyntaxTree} from './analyze';
import {Completion} from './completion';
import { TextDocument } from 'vscode-languageserver-textdocument'
import {
  Connection,
  InitializedParams,
  Range,
  ServerCapabilities,
  SymbolInformation,
  TextDocuments,
} from 'vscode-languageserver/node'
import Parser, { Tree } from 'web-tree-sitter'
// https://github.com/Beaglefoot/awk-language-server/blob/master/server/src/interfaces.ts


export interface TreeByUri {
    [uri: string] : SyntaxTree
}

export interface CliOptions {
  noIndex: boolean
}

export interface Context {
    connection: Connection
    parser: Parser
    completion: Completion
    analyzer: Analyzer
    capabilities: InitializedParams
    documents: TextDocuments<TextDocument>
    trees: TreeByUri
    cliOptions?: CliOptions
}




