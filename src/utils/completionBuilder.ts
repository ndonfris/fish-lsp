import FastGlob  from 'fast-glob';
import {homedir} from 'os';
import { CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import {FishCompletionItemType} from '../completion';
import {logger} from '../logger';
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
    create: () => {}
}

export class CompletionItemBuilder {

    private _item: FishCompletionItem | CompletionItem;

    public constructor() {
        this._item = {} as CompletionItem;
        this._item.label= "";
        this._item.kind = 1;
        this._item.documentation = "";
        this._item.data = {
            localSymbol: false,
            originalCompletion: "",
            fishKind: FishCompletionItemKind.RESOLVE,
        }
    }

    public reset() {
        this._item = {} as CompletionItem;
        this._item.label= "";
        this._item.kind = 1;
        this._item.documentation = "";
        this._item.data = {
            localSymbol: false,
            originalCompletion: "",
            fishKind: FishCompletionItemKind.RESOLVE,
        }
    }

    set item(arg: CompletionItem) {
        this._item = arg;
    }

    get item() {
        return this._item;
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

    public kind(fishKind: FishCompletionItemKind) {
        this._item.kind = toCompletionKind[fishKind];
        this._item.data.fishKind = fishKind;
        return this;
    }


    public documentation(docs: string | MarkupContent) {
        this._item.documentation = docs;
        return this;
    }

    public originalCompletion(shellText: string) {
        this._item.data.originalCompletion = shellText;
        return this;
    }

    public commitCharacters(chars: string[]) {
        this._item.commitCharacters = chars;
        return this;
    }

    public insertText(textToInsert: string) {
        this._item.insertText = textToInsert;
        return this;
    }

    public localSymbol() {
        this._item.data.localSymbol = true;
        return this;
    }

    public build(): CompletionItem {
        return this._item;
    }
}

// fish --command 'complete --do-complete="somecmd"'
// yeilds completions of result: 
//     cmp1\tdescription
//     cmp2
//     cmp3\tdescription
// where completions are split by tab characters, and descriptions are optional.
export type TerminalCompletionOutput = [string, ...string[]];

function splitDescription(...description: string[]): TerminalCompletionOutput {
    if (description === undefined || description.length == 0) {
        return ["", ""]
    }
    if (description.length === 1) {
        return [description[0], ""]
    }
    return [description[0], description.slice(1).join(' ')]

}

function parseDescriptionKeywords(firstItem: string, ...description: string[]): [string, ...string[]] {
    if (description === undefined) {
        return [""]
    }
    if (!firstItem || firstItem === "") {
        return [""];
    } else {
        description.push(...[" ", " "])
        //logger.log("lastIndex " + firstItem.lastIndexOf(":"))
        let fixedItem = ""  // .substring(0, firstItem.lastIndexOf(":")) || ""
        fixedItem += firstItem
        if (firstItem.includes(":")) {
            fixedItem.replace(/[^A-Za-z0-9]/g, '')
            //fixedItem = firstItem.substring(0, firstItem.lastIndexOf(":"))
        }
        //const possibleDescriptionName = description.split(' ', 1);
        if (description.length > 0) { 
            return [fixedItem.toLowerCase(), description[0] || ""]
        } else {
            return [firstItem]
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
export function parseLineForType(label: string, documentationKeyword: string, otherInfo: string) : FishCompletionItemKind{
    return getTypeFromLabel(label) || getTypeFromDocumentation(documentationKeyword, otherInfo)
    //if (tokenType == null) {
    //    //documentation.push(...['', ''])
    //    //const typedDoc: [string, ...string[]] =  [documentation[0], ...documentation.slice(1)]
    //    //const betterDoc = splitDescription(documentation);
    //    //const desc = splitDescription(documentationKeyword);
    //    //if (label === 'fft') {
    //    //    logger.log('fft: '+documentationKeyword)
    //    //    logger.log('fft_documentation: '+otherInfo)
    //    //}
    //    tokenType = getTypeFromDocumentation(documentationKeyword, otherInfo)
    //}
    //return tokenType;
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
    console.log(otherInfo)
    switch (keyword) {
        case 'command': 
            return otherInfo.length >= 1 ? FishCompletionItemKind.CMD_NO_DOC : FishCompletionItemKind.CMD
        case 'variable': 
            return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.USER_FUNC
        case 'alias': 
            return FishCompletionItemKind.ALIAS
        case 'abbreviation':
            return FishCompletionItemKind.ABBR
        case 'Abbreviation:':
            return FishCompletionItemKind.ABBR
        default:
            return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.USER_FUNC
    }

}

