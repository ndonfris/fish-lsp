import FastGlob  from 'fast-glob';
import {homedir} from 'os';
import { Command, CompletionItem, CompletionItemKind, MarkupContent, SymbolKind } from 'vscode-languageserver';
import { CompleteCommand } from '../completion';
//import {FishCompletionItemType} from '../completion';
//import {logger} from '../logger';
import {isBuiltIn} from './completion-types';
import {FishCompletionItemKind} from './completion-strategy';

// fish --command 'complete --do-complete="somecmd"'
// yeilds completions of result: 
//     cmp1\tdescription
//     cmp2
//     cmp3\tdescription
// where completions are split by tab characters, and descriptions are optional.

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
export function parseLineForType(label: string, keyword: string, otherInfo: string) : FishCompletionItemKind{
    let labelType =  getTypeFromLabel(label);
    if (otherInfo === "set") {
        return FishCompletionItemKind.GLOBAL_VARIABLE
    }
    let docType = getTypeFromDocumentation(keyword, otherInfo)
    return labelType !== null ? labelType : docType
}

function getTypeFromLabel(label: string) {
    const firstChar = label.charAt(0)
    switch (firstChar) {
        case '-' :
            return FishCompletionItemKind.FLAG
        case '$': 
            return FishCompletionItemKind.GLOBAL_VARIABLE
        default:
            return isBuiltIn(label) ? FishCompletionItemKind.BUILTIN : null
    }
}


function getTypeFromDocumentation(keyword: string, otherInfo: string) {
    //console.log(otherInfo)
    switch (keyword) {
        case 'command': 
            return otherInfo.length >= 1 ? FishCompletionItemKind.CMD_NO_DOC : FishCompletionItemKind.CMD
        case 'variable': 
            //return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.USER_FUNC
            return FishCompletionItemKind.GLOBAL_VARIABLE
        case 'alias': 
            return FishCompletionItemKind.ALIAS
        case 'abbreviation':
            return FishCompletionItemKind.ABBR
        default:
            //return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.RESOLVE
            return FishCompletionItemKind.GLOBAL_FUNCTION
    }

}