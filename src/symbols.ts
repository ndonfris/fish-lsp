import {
    SymbolInformation,
    SymbolKind,
    WorkspaceSymbol,
    DocumentSymbol,
    LocationLink,
    Location,
    DocumentUri,
    MarkupContent,
    MarkupKind,
    Range
} from 'vscode-languageserver';

 import * as LSP from 'vscode-languageserver'; 
import {SyntaxNode} from 'web-tree-sitter';
import {isBuiltin} from './utils/builtins';
import {findFunctionScope, isCommand, isFunctionDefinitionName, isFunctionDefinition, isStatement, isString, isVariableDefinition, isProgram, isCommandName, findEnclosingVariableScope, isDefinition, findParentFunction} from './utils/node-types';
import {findEnclosingScope, findFirstParent, getChildNodes, getPrecedingComments, getRange} from './utils/tree-sitter';

export interface FishDocumentSymbol extends DocumentSymbol {
    markupContent: MarkupContent;
    commentRange: CommentRange.WithPrecedingComments;
}


// ~~~~REMOVE IF UNUSED LATER~~~~
export function toSymbolKind(node: SyntaxNode): SymbolKind {
    if (isVariableDefinition(node)) {
        return SymbolKind.Variable
    } else if (isFunctionDefinitionName(node)) { // change from isFunctionDefinition(node)
        return SymbolKind.Function;
    } else if (isString(node)) { 
        return SymbolKind.String;
    } else if (isProgram(node) || isFunctionDefinition(node) || isStatement(node)) {
        return SymbolKind.Namespace
    } else if (isBuiltin(node.text) || isCommandName(node) || isCommand(node)) {
        return SymbolKind.Class;
    }
    return SymbolKind.Null
}

/**
 *  Pretty much just for logging a symbol kind 
 */
export function symbolKindToString(kind: SymbolKind) {
    switch (kind) {
        case SymbolKind.Variable:
            return 'Variable';
        case SymbolKind.Function:
            return 'Function';
        case SymbolKind.String:
            return 'String';
        case SymbolKind.Namespace:
            return 'Namespace';
        case SymbolKind.Class:
            return 'Class';
        case SymbolKind.Null:
            return 'Null';
        default:
            return 'Other'
    }
}

export function collectAllSymbolInformation(uri: DocumentUri, root: SyntaxNode): SymbolInformation[] {
    const symbols: SymbolInformation[] = [];
    for (const node of getChildNodes(root).filter(n => isDefinition(n))) {
        const commentRange = CommentRange.create(node)
        const text = commentRange.getInnerText().trim();
        const kind = toSymbolKind(node);
        let range = getRange(node);
        if (kind === SymbolKind.Function) {
            range = commentRange.collect().toFoldRange()
        }
        const parent = commentRange.findParent()
        symbols.push(
            SymbolInformation.create(
                text,
                toSymbolKind(node),
                range,
                uri,
                parent?.text || ''
            )
        );
    }
    return symbols
}

// @TODO: implement const {  enclosingText, enclosingNode, encolsingType } 
//        = DefinitionSyntaxNode.getEnclosingScope(parentNode);
export function DocumentDefSymbol (opts?: {}) {
    const createFunc = (node: SyntaxNode) => {
        const identifier = node.firstNamedChild || node.firstChild!;
        const commentRange = CommentRange.create(identifier);
        return DocumentSymbol.create(
            identifier.text,
            commentRange.markdown(),
            SymbolKind.Function,
            getRange(node), // as per the docs, range should include comments
            getRange(identifier),
            []
        );
    }
    const createVar = (node: SyntaxNode) => {
        const parentNode = node.parent!; 
        const commentRange = CommentRange.create(node)
        const withCommentText = isFunctionDefinition(parentNode) ? parentNode.text.toString() : commentRange.text()
        return DocumentSymbol.create(
            node.text,
            [ 
                `\*(variable)* \**${node.text}**`,
                "___",
                "```fish",
                `${withCommentText.trim()}`,
                "```",
            ].join("\n"),
            SymbolKind.Variable,
            getRange(parentNode), // as per the docs, range should include comments
            getRange(node),
            []
        );
    }
    return {
        createFunc: (node: SyntaxNode) => createFunc(node),
        createVar: (node: SyntaxNode) => createVar(node),
    }
}

/**
 * CommentRange is used to collect the range of a Symbol and its preceding comments.
 * It has a variety of helpers to format, and construct different types of ranges for
 * output symbols. This namespace is used in workspace-symbol.ts, throughout the server,
 * as well as foldingRange.ts.
 *
 * Instantiate with CommentRange.create(node) on nodes that are any of the following types:
 *      • isVariableDefinition(node)
 *      • isFunctionDefinitionName(node)
 *      • isScope(node)
 */
export namespace CommentRange {
    export class WithPrecedingComments {
        private collection: SyntaxNode[] = [];
        private comments: SyntaxNode[] = [];
        /**
         * outerNode would be a function definition
         * @see DocumentSymbol.range
         */
        private outerNode: SyntaxNode; 
        /** 
         * innerNode would be a functionDefinitionName
         * @see DocumentSymbol.selectionRange
         */
        private innerNode: SyntaxNode;
        /**
         * Use CommentRange.create(node) for expected behavior
         */
        constructor(inner: SyntaxNode, outer: SyntaxNode) {
            this.innerNode = inner;
            this.outerNode = outer;
        }
        /**
         * Handled when CommentRange.create(node) is called.
         */
        collect(): WithPrecedingComments {
            this.collection = [this.outerNode];
            let current: SyntaxNode | null = this.outerNode.previousNamedSibling;
            while (current && current.type === 'comment') {
                this.comments.unshift(current);
                this.collection.unshift(current);
                current = current.previousNamedSibling;
            }
            return this;
        }
        /**
         * The text to use when a fold is collapsed
         */
        foldText(): string {
            return this.getInnerText();
        }
        /**
         * Returns a range, which might not be accessible to Tree-Sitter (if there is 
         * preceding comments). This is intended behavior for folds, to collapse comments
         * with their symbol.
         */
        toFoldRange(): Range {
            const start = this.collection[0].startPosition;                              
            const end = this.collection[this.collection.length - 1].endPosition;                   
            return Range.create(start.row, start.column, end.row, end.column); 
        }
        get getTitleString(): string {
            return `*(${this.type})* \**${this.getInnerText()}**`;
        }
        public getInnerText(): string {
            return this.innerNode.text;
        }
        public getEnclosingText(): string {
            const lines = this.outerNode.text.split('\n')
            if (lines.length > 1) {
                const lastLine = this.outerNode.lastChild?.startPosition.column || 0;
                return lines.map(line => line.replace(' '.repeat(lastLine), '')).join('\n');
            }
            return this.outerNode.text || "";
        }
        private leadingCommentsToMarkdown(): string {
            return this.comments.length > 0 
                ? ['```fish', this.leadingCommentsText, '```', '___'].join('\n')
                : '___';
        }
        get leadingComments(): SyntaxNode[] {
            return this.comments;
        }
        get leadingCommentsText(): string {
            return this.leadingComments.map(node => node.text.trimStart()).filter(line => line.trim() !== '').join('\n');
        }
        get type(): "function" | "variable" | 'scope' {
            return isFunctionDefinitionName(this.innerNode) ? 'function' 
                 : isVariableDefinition(this.innerNode)     ? 'variable' : 'scope'
        }
        get outerRange(): Range {
            return getRange(this.outerNode);
        }
        get innerRange(): Range {
            return getRange(this.innerNode);
        }
        /**
         * Returns a string, formatted propperly containing the preceding comments, and 
         * the symbol's text.
         */
        text(): string {
            if (this.leadingComments.length > 0) {
                return [
                    this.leadingCommentsText,
                    this.getEnclosingText(),
                ].join("\n");
            } else {
                return this.getEnclosingText();
            }
        }
        markdown(): string {
            return [
                    '```fish',
                    this.leadingCommentsText,
                    this.getEnclosingText(),
                    '```'
                ].join('\n');
        }
        /**
         * Returns a formatted string for a symbol.detail, or Hover Contents.
         *
         * @returns {MarkupContent} - Formatted MarkupContent String
         */
        toMarkupContent(): MarkupContent {
            return {
                kind: MarkupKind.Markdown,
                value: [
                    this.getTitleString,
                    "```fish",
                    this.comments.length > 0
                        ? ["```fish", this.leadingCommentsText, "```", "___"].join("\n")
                        : "___",
                    this.getEnclosingText(),
                    "```",
                ].join("\n")
            }
        }
        /**
         * Creates a new document symbol, with the correct range, and selection range.
         */
        toDocumentSymbol(): DocumentSymbol {
            return DocumentSymbol.create(
                this.getInnerText(),
                this.text(),
                toSymbolKind(this.innerNode),
                this.outerRange,
                this.innerRange,
                []
            );
        }
        /**
         * Creates a FishDocumentSymbol, (defined above), which has keys: MarkupContent,
         * and commentRange. 
         */
        toFishDocumentSymbol(): FishDocumentSymbol {
            return {
                ...this.toDocumentSymbol(),
                markupContent: this.toMarkupContent(),
                commentRange: this,
            }

        }

        findParent(): SyntaxNode | null {
            const parent = findFirstParent(this.innerNode, n => isFunctionDefinition(n))
            if (parent && isFunctionDefinitionName(parent.firstNamedChild || parent)) {
                return parent.firstNamedChild
            }
            return  null;
        }

    }
    /**
     * Handles the creation of a CommentRange.WithPrecedingComments object.
     * Should be called on nodes that are any of the following types:
     *     • isVariableDefinition(node)
     *     • isFunctionDefinitionName(node)
     *     • isScope(node)
     */
    export const create = (innerNode: SyntaxNode): WithPrecedingComments => {
        const outerNode = innerNode.parent!
        const comments = new WithPrecedingComments(innerNode, outerNode);
        return comments.collect();
    }

    export const createFishDocumentSymbol = (node: SyntaxNode): FishDocumentSymbol => {
        return create(node).toFishDocumentSymbol();
    }

}


// FishSymbols {
//     GlobalSymbol
//          - CommandSymbol
//          - VariableSymbol
//     LocalSymbol
//          - FunctionSymbol
//          - VariableSymbol
//          - ScopeSymbol
// }

//import { SyntaxNode, DocumentSymbol, SymbolKind } from "web-tree-sitter"
//
//function collapseToSymbols(root: SyntaxNode): DocumentSymbol[] {
//    const symbols: DocumentSymbol[] = []
//    const stack: SyntaxNode[] = [root]
//
//    while (stack.length > 0) {
//        const node = stack.pop()
//
//        if (node.type === "function_def") {
//            symbols.push({
//                name: node.children.find(c => c.type === "identifier").text,
//                kind: SymbolKind.Function,
//                range: node.range,
//                selectionRange: node.range
//            })
//        } else if (node.type === "variable_def") {
//            symbols.push({
//                name: node.children.find(c => c.type === "identifier").text,
//                kind: SymbolKind.Variable,
//                range: node.range,
//                selectionRange: node.range
//            })
//        } else {
//            for (const child of node.children) {
//                stack.push(child)
//            }
//        }
//    }
//
//    return symbols
//}
//
