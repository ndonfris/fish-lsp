

import FastGlob from 'fast-glob';
import {homedir} from 'os';
import { CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';
import {FishCompletionItemType} from '../completion';
import {FishCompletionItemKind, fishCompletionItemKindMap, isBuiltIn, isGlobalFunction} from './completion-types';

const toCompletionKind: Record<FishCompletionItemKind, CompletionItemKind> = {
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

const FishK = {fish: FishCompletionItemKind.ABBR, type: CompletionItemKind.Interface}

export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent; 
    data: {
        originalCompletion: string; // the original line in fish completion call from the terminal
        fishKind: FishCompletionItemKind; // VERBOSE form of kind
        localSymbol: boolean;
    }
}

export class CompletionItemBuilder {

    private _item: FishCompletionItem;

    constructor(label: string) {
        this._item = CompletionItem.create(label) as FishCompletionItem;
        this._item.data.localSymbol = false;
    }

    kind(fishKind: FishCompletionItemKind) {
        this._item.kind = toCompletionKind[fishKind];
        this._item.data.fishKind = fishKind;
    }

    documentation(docs: string | MarkupContent) {
        this._item.documentation = docs;
    }

    originalCompletion(shellText: string) {
        this._item.data.originalCompletion = shellText;
    }

    commitCharacters(chars: string[]) {
        this._item.commitCharacters = chars;
    }

    insertText(textToInsert: string) {
        this._item.insertText = textToInsert;
    }

    localSymbol() {
        this._item.data.localSymbol = true;
    }

    build() {
        return this._item;
    }

}

class FishFileLocationResolver {

    public globalFunctions: string[] = [];
    public userFunctions: string[] = [];
    public otherFunctions: string[] = [];

    public readonly defaultGlobalPath = '/usr/share/fish';
    public readonly defaultUserPath = `${homedir()}/.config/fish`;

    private _otherPaths: string[] = []
    private _allPaths: string[] = []

    public async create(...locations: string[]) {
        this.otherPaths.push(...locations)
        const allPathsToSearch = [
            this.defaultGlobalPath,
            this.defaultUserPath,
            this._otherPaths,
        ]
        this._allPaths = await this.getAbsoluteFilePaths(allPathsToSearch)
        return this._allPaths;
    }   
    
    private async getAbsoluteFilePaths(...paths: string[]) {
        const found : string[] = [];
        paths.forEach((path: string) => {
            const files = FastGlob.sync("**.fish", {
                absolute: true,
                dot: true,
                globstar: true,
                cwd: path,
            });
            found.push(...files)
        })
        return found;
    }

    get otherPaths() {
        return this._otherPaths
    }

    get allAbsolutePaths() {
        return this._allPaths;
    }

    private getFunctionNameFromPath(path: string) {
        const pathArr = path.split('/');
        if (pathArr.lastIndexOf('functions') === pathArr.length - 2) {
            const filename = pathArr[-1] || ''
            return filename.replace('.fish', '')
        }
        return ''
    }

    private setFunctionPaths() {
        const locs = FastGlob.sync("functions/**.fish", {
            absolute: false,
            dot: true,
            globstar: true,
            cwd: this.defaultUserPath,
        });
        const globs = FastGlob.sync("functions/**.fish", {
            absolute: false,
            dot: true,
            globstar: true,
            cwd: this.defaultGlobalPath
        })
    }
}


function parseLineForType(label: string, ...documentation: string[]) {
    let tokenType = getTypeFromLabel(label) 
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

