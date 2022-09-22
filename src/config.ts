import * as LSP from 'vscode-languageserver';
import {ServerCapabilities, TextDocumentClientCapabilities} from 'vscode-languageserver';
//
//checkout /home/ndonfris/repos/fish-lsp/node_modules/typescript/lib./protocol.d.ts

import which from 'which'
import deepmerge from 'deepmerge';
import path from 'node:path';
import type * as lsp from 'vscode-languageserver';
import type tsp from 'typescript/lib/protocol.d.js';
import {CommandTypes, UserPreferences} from './fish-protocol';
import {TextDocument} from 'vscode-languageserver-textdocument';
//import { LspDocuments } from './document';
//import { CommandTypes } from './tsp-command-types';
//import type { TypeScriptInitializationOptions } from './ts-protocol';
//import type { TspClient } from './tsp-client';
//import API from './utils/api';


export enum FishServerLogLevel {
  Off,
  Normal,
  Terse,
  Verbose
}

// https://github.com/typescript-language-server/typescript-language-server/blob/114d4309cb1450585f991604118d3eff3690237c/src/configuration-manager.ts#L45
// goal tm will be to implement const enum of server settings.

//export enum


export interface SupportedFeatures {
    completionAbbr?: boolean;
}


const DEFAULT_CAPABILITIES: ServerCapabilities = {
    completionProvider: {
        resolveProvider : true,
        completionItem: {
            labelDetailsSupport: true
        },
        workDoneProgress: true,
    },
    definitionProvider: true,
    hoverProvider: true,
    //inlayHintProvider: true,
    //executeCommandProvider: {
        //commands: [
            //"show.command_history"
        //]
    //}
}

// import type tsp from 'typescript/lib/protocol.d.js';
// Required<tsp.UserPrefrences>
const DEFAULT_SERVER_PREFERENCES: UserPreferences = {
    allowIncompleteCompletions: true,
    allowRenameOfImportPath: true,
    allowTextChangesInNewFiles: true,
    disableSuggestions: false,
    includeInlayParameterNameHints: 'none',
    includeInlayPropertyDeclarationTypeHints: false,
    useLabelDetailsInCompletionEntries: true,
};

export interface WorkspaceConfiguration {
    completions?: WorkspaceConfigurationCompletionOptions;
    diagnostics?: WorkspaceConfigurationDiagnosticsOptions;
}

export interface WorkspaceConfigurationLanguageOptions {
    format?: tsp.FormatCodeSettings;
    //inlayHints?: TypeScriptInlayHintsPreferences;
}

/* eslint-enable @typescript-eslint/indent */
interface WorkspaceConfigurationDiagnosticsOptions {
    ignoredCodes?: number[];
    showVariableExpansionInSingleQuote?: boolean;
}

export interface WorkspaceConfigurationCompletionOptions {
    completePrivateFunctions?: boolean;
    alwaysCompleteArguments?: boolean; 
}


export class ConfigurationManager {
    public preferences: Required<UserPreferences> = deepmerge({}, DEFAULT_SERVER_PREFERENCES);
    public workspaceConfiguration: WorkspaceConfiguration = {};

    constructor(private readonly documents: TextDocument) {}

    public mergePreferences(preferences: UserPreferences): void {
        this.preferences = deepmerge(this.preferences, preferences);
    }

    public setWorkspaceConfiguration(configuration: WorkspaceConfiguration): void {
        this.workspaceConfiguration = configuration;
    }

    public getPreferences(filename: string): UserPreferences {
        //const workspacePreferences = this.getWorkspacePreferencesForFile(filename);
        const preferences = Object.assign<UserPreferences, UserPreferences>(
            {},
            this.preferences,
            //workspacePreferences?.inlayHints || {},
        );

        return {
            ...preferences,
            //quotePreference: this.getQuoteStylePreference(preferences),
        };
    }
}


