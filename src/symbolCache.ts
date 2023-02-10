
import { SymbolKind, MarkupContent, WorkspaceSymbol, Location, Range, DocumentUri, BaseSymbolInformation } from 'vscode-languageserver';
import {  execOpenFile, execFindDependency, execEscapedCommand, execCommandDocs  } from './utils/exec'
import { toSymbolKind } from './symbols';
import { LspDocument } from './document';
import { findParentCommand, isCommandName, isDefinition, isFunctionDefinition, isScope, isVariableDefinition } from './utils/node-types';


namespace FishWorkspaceSymbol {

    export interface FishWorkspaceSymbol extends BaseSymbolInformation {
        name: string,
        kind: SymbolKind;
        resolved: boolean;
        documentation?: string;
        allowRename?: boolean;
        uri?: DocumentUri;
        range?: Range; // selectionRange
        autoloaded?: boolean;
        command?: {
            uriCommand?: string,
            docCommand?: string,
        }
    }

    export const create = (name: string, kind: SymbolKind ) => {
        return {
            name,
            kind,
            resolved: false,
        }
    }

}


export class WorkspaceCache {

    public unresolved = new Map<string, FishWorkspaceSymbol.FishWorkspaceSymbol[]>();
    public resolved = new Map<string, FishWorkspaceSymbol.FishWorkspaceSymbol[]>();

    public async initialize() {
        await Promise.all([
            execEscapedCommand('set -n'),
            //execEscapedCommand(`functions -an`),
            execEscapedCommand('builtin -n'),
        ]).then(([vars, /*funcs,*/ builtins]) => {
            vars.forEach((varName: string) => {
                const newSymbol = FishWorkspaceSymbol.create(varName, SymbolKind.Variable);
                this.unresolved.set(varName, [newSymbol])
            });
            //funcs.forEach((funcName: string) => {
                //const newSymbol = FishWorkspaceSymbol.create(funcName, SymbolKind.Function);
                //this.unresolved.set(funcName, [newSymbol])
            //});
            builtins.forEach((builtinName: string) => {
                const newSymbol = FishWorkspaceSymbol.create(builtinName, SymbolKind.Class);
                this.unresolved.set(builtinName, [newSymbol])
            })
            //initializeMap(funcs, SymbolKind.Function);
            //initializeMap(builtins, SymbolKind.Class);
        })
    }

    async resolve(query: string) {
        if (this.resolved.has(query)) return this.resolved.get(query);
        let symbol = this.unresolved.get(query);
        if (symbol) {
            this.unresolved.delete(query);
            switch (symbol[0].kind) {
                case SymbolKind.Variable:
                    const varDef = await execOpenFile(`set -l ${query}`);

                case SymbolKind.Function:

                case SymbolKind.Class:

            }
        } else {
            return this.resolved.get(query)
        }

    }

    public async getExports(uri: string) {
        const text = await execOpenFile(uri);

    }
    

    
}

/**
 * just a getter for the absolute path to a function defined
 */
async function getFunctionUri(name: string): Promise<string | undefined> {
    const uriString = await execEscapedCommand(`type -ap ${name}`)
    const uri = uriString.join('\n').trim();
    if (!uri) {
        return undefined;
    }
    return uri;
}

/**
 * builds MarkupString for function names, since fish shell standard for private functions
 * is naming convention with leading '__', this function ensures that our MarkupStrings
 * will be able to display the FunctionName (instead of interpreting it as '__' bold text)
 */
function escapePathStr(functionTitleLine: string) : string {
    const afterComment =  functionTitleLine.split(' ').slice(1)
    const pathIndex = afterComment.findIndex((str: string) => str.includes('/')) 
    const path = afterComment[pathIndex]
    return [
    '**'+afterComment.slice(0, pathIndex).join(' ').trim() + '**',
    `*\`${path.toString()}\`*`,
    '**'+afterComment.slice(pathIndex + 1).join(' ').trim() + '**'
    ].join(' ')
}

/**
 * builds FunctionDocumentaiton string
 */
async function getFunctionDocString(name: string): Promise<string | undefined> {
    const docStr = await execCommandDocs(name);
    if (docStr) {
        const docTitle = docStr.split('\n')[0]
        const docBody = docStr.split('\n').slice(1).join('\n');
        return [
            `${escapePathStr(docTitle).trim()}`,
            '___',
            '```fish',
            docBody,
            '```'
        ].join('\n');
    }
    return undefined;
}
/** 
 * builds MarkupString for builtin documentation
 */
export async function getBuiltinDocString(name: string): Promise<string | undefined> {
    const cmdDocs: string = await execCommandDocs(name);
    if (!cmdDocs) return undefined
    const splitDocs = cmdDocs.split('\n');
    const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME')
    return [
        `__${name.toUpperCase()}__ - _https://fishshell.com/docs/current/cmds/${name.trim()}.html_`,
        `___`,
        '```man',
        splitDocs.slice(startIndex).join('\n'),
        '```'
    ].join('\n') 
}
/**
 * builds MarkupString for global variable documentation
 */
async function getVariableDocs(name: string): Promise<string | undefined> {
    const docs = await execEscapedCommand(`set --show ${name}`)
    if (!docs) {
        return undefined;
    }
    const splitDocs = docs.join('\n').split('\n');
    const splitTitleArray = splitDocs[0].split(':');
    const splitOther: string[] = splitDocs.slice(1);
    const formattedOther = splitOther.map((line: string) => {
        const arr = line.split(': ');
        const fishScript = ['**|**', arr[1].slice(1,-1), '**|**'].join('`')
        return `*${arr[0]}*: ${fishScript}`
    }).join('\n')
    return [
        `**${splitTitleArray[0].trim()}** - *${splitTitleArray[1].trim()}*`,
        '___',
        formattedOther
    ].join('\n')
}
