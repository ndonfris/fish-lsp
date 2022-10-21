import { CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import { FishCompletionItemKind } from './completion-types';
export declare const toCompletionKind: Record<FishCompletionItemKind, CompletionItemKind>;
export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent;
    data?: {
        originalCompletion?: string;
        fishKind?: FishCompletionItemKind;
        localSymbol?: boolean;
    };
}
export declare class CompletionItemBuilder {
    private _item;
    constructor();
    get item(): CompletionItem;
    create(label: string): this;
    kind(fishKind: FishCompletionItemKind): this;
    documentation(docs: string | MarkupContent): void;
    originalCompletion(shellText: string): void;
    commitCharacters(chars: string[]): void;
    insertText(textToInsert: string): void;
    localSymbol(): void;
    build(): CompletionItem;
}
export declare type TerminalCompletionOutput = [string, ...string[]];
/**
 * Retrieves a FishCompletionItemKind for a line of shell output.
 * Input params can be typed by the exported type TerminalCompletionOutput
 * @see TerminalTCompletionOutput
 *
 * @param {string} label - the label we should use for a completion
 * @param {string[]} documentation - the documentation for a completion which might not
 *                                   have been written.
 * @returns {FishCompletionItemKind} - enum used to determine what type of completion to
 *                                     build.
 */
export declare function parseLineForType(label: string, ...documentation: string[]): FishCompletionItemKind;
//# sourceMappingURL=completionBuilder.d.ts.map