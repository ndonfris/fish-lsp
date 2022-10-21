

import FastGlob from 'fast-glob';
import {homedir} from 'os';
import { CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import {FishCompletionItemType} from '../completion';
import {FishCompletionItemKind, fishCompletionItemKindMap, isBuiltIn, isGlobalFunction} from './completion-types';

export const toCompletionKind: Record<FishCompletionItemKind, CompletionItemKind> = {
    [FishCompletionItemKind.ABBR]: CompletionItemKind.Interface,                // interface
    [FishCompletionItemKind.ALIAS]: CompletionItemKind.Struct,                  // struct
    [FishCompletionItemKind.BUILTIN]: CompletionItemKind.Keyword,               // keyword
    [FishCompletionItemKind.GLOBAL_VAR]: CompletionItemKind.Constant,           // constant
    [FishCompletionItemKind.LOCAL_VAR]: CompletionItemKind.Variable,            // variable
    [FishCompletionItemKind.USER_FUNC]: CompletionItemKind.Function,            // function
    [FishCompletionItemKind.GLOBAL_FUNC]: CompletionItemKind.Method,            // method
    [FishCompletionItemKind.LOCAL_FUNC]: CompletionItemKind.Constructor,        // constructor
    [FishCompletionItemKind.FLAG]: CompletionItemKind.Field,                    // field
    [FishCompletionItemKind.CMD]: CompletionItemKind.Class,                     // class
    [FishCompletionItemKind.CMD_NO_DOC]: CompletionItemKind.Class,              // class
    [FishCompletionItemKind.RESOLVE]: CompletionItemKind.Unit                   // unit
}

export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent; 
    data?: {
        originalCompletion?: string; // the original line in fish completion call from the terminal
        fishKind?: FishCompletionItemKind; // VERBOSE form of kind
        localSymbol?: boolean;
    }
}

export class CompletionItemBuilder {

    private _item: FishCompletionItem | CompletionItem | null;

    constructor() {
        this._item = null;
    }

    get item() {
        if (!this._item) {
            this._item = {
                label: "",
                description: "",
                data: {
                    localSymbol: false,
                    originalCompletion: "",
                    fishKind: FishCompletionItemKind.RESOLVE,
                }

            } as CompletionItem;
            return this._item
        }
        return this._item
    }

    public create(label: string) { 
        this._item = CompletionItem.create(label);
        this._item.data = {
            originalCompletion: "",
            fishKind: FishCompletionItemKind.RESOLVE,
            localSymbol: false
        }
        return this;
    }

    kind(fishKind: FishCompletionItemKind) {
        this.item.kind = toCompletionKind[fishKind];
        this.item.data.fishKind = fishKind;
        return this;
    }


    documentation(docs: string | MarkupContent) {
        this.item.documentation = docs;
    }

    originalCompletion(shellText: string) {
        this.item.data.originalCompletion = shellText;
    }

    commitCharacters(chars: string[]) {
        this.item.commitCharacters = chars;
    }

    insertText(textToInsert: string) {
        this.item.insertText = textToInsert;
    }

    localSymbol() {
        this.item.data.localSymbol = true;
    }

    public build(): CompletionItem {
        return this.item;
    }

}

// fish --command 'complete --do-complete="somecmd"'
// yeilds completions of result: 
//     cmp1\tdescription
//     cmp2
//     cmp3\tdescription
// where completions are split by tab characters, and descriptions are optional.
export type TerminalCompletionOutput = [string, ...string[]];

function parseDescriptionKeywords(...description: string[]): TerminalCompletionOutput {
    const secondItem = description[0].replace(':', ''); 
    let results: string[] = []
    if (secondItem === "") {
        return [""];
    } else {
        if (secondItem.includes(' ')) { 
            results = secondItem.split(' ', 2)
            return [results[0].toLowerCase(), ...results.slice(1)]
        } else {
            return [secondItem]
        }
    }
}   

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
export function parseLineForType(label: string, ...documentation: string[]) : FishCompletionItemKind{
    let tokenType = getTypeFromLabel(label) 
    if (tokenType == null) {
        const keywordsArray = parseDescriptionKeywords(...documentation)
        tokenType = getTypeFromDocumentation(...keywordsArray)
    }
    return tokenType;
}

function getTypeFromLabel(label: string) {
    const firstChar = label.charAt(0)
    switch (firstChar) {
        case '-' :
            return FishCompletionItemKind.FLAG
        case '$': 
            return FishCompletionItemKind.GLOBAL_VAR
        default:
            return isBuiltIn(label) ? FishCompletionItemKind.BUILTIN : null
    }
}


function getTypeFromDocumentation(keyword: string, ...otherInfo: string[]) {
    switch (keyword) {
        case 'command': 
            return otherInfo.length >= 1 ? FishCompletionItemKind.CMD_NO_DOC : FishCompletionItemKind.CMD
        case 'alias': 
            return FishCompletionItemKind.ALIAS
        case 'abbreviation':
            return FishCompletionItemKind.ABBR
        default:
            return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.USER_FUNC
    }

}

