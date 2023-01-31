
import { SymbolKind, MarkupContent, WorkspaceSymbol, Location, Range, DocumentUri, BaseSymbolInformation } from 'vscode-languageserver';
import {  execOpenFile, execFindDependency, execEscapedCommand  } from './utils/exec'
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

    //export const create = (name: string, kind: SymbolKind, documentation: string, allowRename: boolean, resolved?: boolean, uri?: DocumentUri, range?: Range, autoloaded?: boolean, command?: { uriCommand?: string, docCommand?: string}): FishWorkspaceSymbol => {
    //    return {
    //        name,
    //        kind,
    //        uri,
    //        range,
    //        autoloaded,
    //        resolved: resolved ?? false,
    //        command,
    //        allowRename: allowRename ?? true,
    //        documentation: documentation ?? ''
    //    }
    //}

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
            execEscapedCommand(`functions -an`),
            execEscapedCommand('builtin -n'),
        ]).then(([vars, funcs, builtins]) => {
            vars.forEach((varName: string) => {
                const newSymbol = FishWorkspaceSymbol.create(varName, SymbolKind.Variable);
                this.unresolved.set(varName, [newSymbol])
            });
            funcs.forEach((funcName: string) => {
                const newSymbol = FishWorkspaceSymbol.create(funcName, SymbolKind.Function);
                this.unresolved.set(funcName, [newSymbol])
            });
            builtins.forEach((builtinName: string) => {
                const newSymbol = FishWorkspaceSymbol.create(builtinName, SymbolKind.Class);
                this.unresolved.set(builtinName, [newSymbol])
            })
            //initializeMap(funcs, SymbolKind.Function);
            //initializeMap(builtins, SymbolKind.Class);
        })
    }


    
}










