

import deepmerge from 'deepmerge';
import { LspDocuments } from './document';
import {
    Connection, FormattingOptions,
} from 'vscode-languageserver';


export interface ServerPreferences {
    displaySuggestions?: boolean
    completeFunctionCalls?: boolean,
    completeVariables?: boolean,
    hirearchicalDocumentSymbolSupport?: boolean,
    // formatting
    // debugging

    formatting?: FishFormattingOptions,
}

export interface FishFormattingOptions extends FormattingOptions {
    formatOnSave?: boolean,
    trimTrailingWhitespace?: boolean,
    trimFinalNewlines?: boolean,
    removeLeadingSwitchCaseWhitespace?: boolean,
    insertFinalNewline?: boolean
}

export const FishFormattingDefaults : FishFormattingOptions = {
    formatOnSave: false,
    tabSize: 4,
    insertSpaces: true,
    trimTrailingWhitespace: true,
    trimFinalNewlines: true,
    insertFinalNewline: true,
    removeLeadingSwitchCaseWhitespace: true,
}

const DEFAULT_PREFERENCES: ServerPreferences  = {
    displaySuggestions: true,
    completeFunctionCalls: true,
    completeVariables: true,
    hirearchicalDocumentSymbolSupport: false,

    formatting: FishFormattingDefaults,

}




export class ConfigManager {

    private preferences: Required<ServerPreferences> = deepmerge({}, DEFAULT_PREFERENCES);

    constructor(private readonly documents: LspDocuments) {}

    public mergeTsPreferences(preferences: ServerPreferences): void {
        this.preferences = deepmerge(this.preferences, preferences);
    }

    public getFormattingOptions() : FishFormattingOptions {
        return this.preferences.formatting;
    }

    // @TODO: write config
    public getInlayHintsEnabled() : boolean {
        return true;
    }

}


