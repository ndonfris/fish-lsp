import {DocumentUri, Range} from 'vscode-languageserver-textdocument';
import {
    Diagnostic,
    DiagnosticRelatedInformation,
    InlayHint,
    SymbolInformation,
    BaseSymbolInformation,
    DocumentSymbol,
    Location,
    Definition,
    RenameParams,
    RenameFile,
    ReferencesRequest,
    SemanticTokens,
    SignatureHelpParams,
    SymbolKind,
} from "vscode-languageserver";
import { SyntaxNode } from "web-tree-sitter";
import { SyntaxTree } from "./analyse";
//import {LspDocuments} from './document';
import { isBuiltin } from "./utils/builtins";
import {execFindDependency} from './utils/exec';
import {
    findFunctionScope,
    isBeforeCommand,
    isCommand,
    isFunctionDefinintion,
    isStatement,
    isVariable,
} from "./utils/node-types";
import {getRange} from './utils/tree-sitter';

// subclass of analyzer
// should map getRange to syntaxNodes,
// can you some of the implementations for server.onHover()
//  • implements refrences
//  • implements workspace diagnostics for server.onContentChanged()
//  • implements inlay hints
//  • implements goto defeinition?
//  • implements rename?
//  • implements signature

// PROBS GO LOOK AT TSSERVER

// simple diagnostic example: https://github.com/microsoft/vscode-extension-samples/blob/main/diagnostic-related-information-sample/src/extension.ts
// 1.) get all locations

// after completing this file, add commands.ts
// use script to retrieve filelocation if exists.
export class FishDiagnostics {
    // decide what is needed for ^^^^^^^^
    // implement in (server or analyzer)??

    //
    // inlay hints
    //      • show refrences
    //
    // diagnostics
    //      • show end for statements
    //      • has varaible definition
    //      • multiple non-private functions per lazy loaded directory
    //      • '$asdf' -> wrong variable expansion
    //      • find similair name
    //      • check valid syntax
    //      • check valid flag
    //      • check for list
    //      • indent?
    //      • pipe errs to /dev/null
    //      • name matches filename
    //      • command not recognized
    //      • move functions to ~/.config/fish/functions/ instead of config/fish/config.fish
    //      • local variable is not used
    // (rest of ideas below)

    private locations: Location[];
    private symbols: Map<string, SymbolInformation[]>;
    //private tree: SyntaxTree;
    //private uri: string;

    constructor() {
        //this.uri = uri
        //this.tree = tree;
        this.locations = [];
        this.symbols = new Map<string, SymbolInformation[]>();
        // this.diagnostics = diagnostics
        // this.documentSymbols = documentSymbols
        // this.inlayHints = inlayHits
        // this.defintions = definitions
        // this.semanticTokens = semanticTokens
        // this.signature = signature
    }

    //
    // TODO: ...stuff...
    //

    public async initializeLocations(uri: string, tree: SyntaxTree) {
        for (const func of tree.functions) {
            this.locations.push(Location.create(uri, getRange(func)))
        }
        for (const variable of tree.variable_definitions) {
            this.locations.push(Location.create(uri, getRange(variable)))
        }
        for (const cmd of tree.commands) {
            const cmdDep = await execFindDependency(cmd.child(0)!.text)
        }

    }

    //public async initializeDocSymbols() {
    //    const tree = this.tree;
    //    for (const func of tree.functions) {
    //        const funcDef = func.child(1)!
    //        const funcName = funcDef.text || ""
    //        const funcKind = getSymbolKind(func)
    //        const funcText = func.text
    //        const funcRange = getRange(func)
    //        const defRange = getRange(funcDef)
    //        this.symbols.push(DocumentSymbol.create(funcName, funcText, funcKind, funcRange, defRange))
    //    }
    //}

}


// might be better to just create on the fly, and only show inlayHints for current document
// tldr signature would be nice
export class FishSymbol {
    private kind: SymbolKind;
    private name: string;
    private range: Range;
    private uri: DocumentUri;
    private location: Location;
    private refrences: Location[] = [];
    private containerName?: string;
    private symbolInfo: SymbolInformation;

    private children: FishSymbol[] = [];

    constructor(name: string, node: SyntaxNode, uri: DocumentUri, containerName?: string) {
        this.name = name;
        this.kind = getSymbolKind(node)
        this.range = getRange(node)
        this.uri = uri;
        const possibleParent = findFunctionScope(node)
        if (containerName != "") {
            this.containerName = containerName
        }else if (possibleParent)  {
            this.containerName = possibleParent.child(1)!.text
        }
        this.location = Location.create(uri, this.range)
        this.symbolInfo = SymbolInformation.create(this.name, this.kind, this.range, this.uri, this.containerName)
    }

    getName() {
        return this.name
    }

    getUri() {
        return this.uri
    }

    getSymbolInfo() {
        return this.symbolInfo
    }

    addChild( node: SyntaxNode ) {
        const child = new FishSymbol(this.name, node, this.uri, this.name)
        this.children.push(child)
    }

    getLocalLocations() {
        const locations = []
        for (const child of this.children.values()) {
            locations.push(child.location)
        }
        return locations;
    }

    addRefrence(uri: string, node: SyntaxNode) {
        this.refrences.push(Location.create(uri, getRange(node)))
    }


    getGlobalLocations() {
        return this.refrences
    }

    getAllLocations() {
        return [
            ...this.refrences,
            ...this.children.map(child => child.location)
        ]
    }

    getRefrenceCount() {
        return this.getAllLocations().length
    }

    getDefinintion() {
        return this.location
    }
}

//export function buildSymbol(tree: SyntaxTree, documents: LspDocuments) {
//    
//
//}
//

export function getSymbolKind(node: SyntaxNode): SymbolKind {
    if (isVariable(node)) {
        return SymbolKind.Variable;
    } else if (isFunctionDefinintion(node)) {
        return SymbolKind.Function;
    } else if (isStatement(node)) {
        return SymbolKind.Namespace;
    } else if (isCommand(node)) {
        const text = node.child(0)?.text
        if (text && isBuiltin(text)) {
            return SymbolKind.Struct;
        }
        return SymbolKind.File;
    } else if (isBeforeCommand(node)) {
        return SymbolKind.Interface;
    } else {
        return SymbolKind.Field;
    }
}

//
//  goto defintion
//      • goto defintion
//
//  goto refrences
//      • goto refrences
//
//  goto
//      • goto refrences
//
// signature help:
//      • show manpage/tldr
//
// include code-actions here?
// include formatter here?
//
// Possible code-actions/commands:
//      • refactor to private function
//      • run subcommand
//      • execute current line
//      • goto manpage
//      • /usr/share/fish
//      • use fallback documentation provider
//      • install fallback documentation provider (tldr)
//      • goto config.fish
//      • enable --help completions in .config/fish/completions/*.fish
//      • search in history?
//      •
//
//
