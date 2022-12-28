

import deepmerge from 'deepmerge';
import { LspDocuments } from './document';
import {
    Connection,
} from 'vscode-languageserver';


export interface ServerPreferences {
    displaySuggestions?: boolean
    completeFunctionCalls?: boolean,
    completeVariables?: boolean,
    hirearchicalDocumentSymbolSupport?: boolean,
}

const DEFAULT_PREFERENCES: ServerPreferences  = {
    displaySuggestions: true,
    completeFunctionCalls: true,
    completeVariables: true,
    hirearchicalDocumentSymbolSupport: false,

}




export class ConfigManager {

    private preferences: ServerPreferences;

    constructor(private readonly documents: LspDocuments) {
        this.preferences = DEFAULT_PREFERENCES;
    }

    getPreference(key: keyof ServerPreferences) {
        return this.preferences[key];
    }

    setPreference(key: keyof ServerPreferences, value: any) {
        this.preferences[key] = value;
    }

}

