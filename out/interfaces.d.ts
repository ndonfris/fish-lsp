import { Analyzer, SyntaxTree } from './analyze';
import { Completion } from './completion';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection, InitializedParams, TextDocuments } from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
export interface TreeByUri {
    [uri: string]: SyntaxTree;
}
export interface CliOptions {
    noIndex: boolean;
}
export interface Context {
    connection: Connection;
    parser: Parser;
    completion: Completion;
    analyzer: Analyzer;
    capabilities: InitializedParams;
    documents: TextDocuments<TextDocument>;
    trees: TreeByUri;
    cliOptions?: CliOptions;
}
//# sourceMappingURL=interfaces.d.ts.map