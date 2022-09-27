import { Hover, MarkupContent } from 'vscode-languageserver-protocol/node';
import { SyntaxNode } from 'web-tree-sitter';
import { CompletionArguments } from './utils/exec';
export declare type markdownFiletypes = 'fish' | 'man';
export declare function enrichToMarkdown(doc: string): MarkupContent;
export declare function enrichToCodeBlockMarkdown(doc: string, filetype?: markdownFiletypes): MarkupContent;
export declare function enrichCommandArg(doc: string): MarkupContent;
export declare function enrichToPlainText(doc: string): MarkupContent;
export declare function documentationHoverProvider(cmd: string): Promise<Hover | null>;
export declare function documentationHoverCommandArg(root: SyntaxNode, cmp: CompletionArguments): Hover;
//# sourceMappingURL=documentation.d.ts.map