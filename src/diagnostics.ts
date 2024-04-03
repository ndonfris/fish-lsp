import { DocumentUri, Range } from 'vscode-languageserver-textdocument';
import {
  Diagnostic,
  DiagnosticRelatedInformation,
  //InlayHint,
  SymbolInformation,
  //BaseSymbolInformation,
  DocumentSymbol,
  Location,
  Definition,
  RenameParams,
  RenameFile,
  ReferencesRequest,
  SemanticTokens,
  SignatureHelpParams,
  SymbolKind,
} from 'vscode-languageserver/node';
import { SyntaxNode } from 'web-tree-sitter';
//import { SyntaxTree } from "./analyze";
//import {LspDocuments} from './document';
import { isBuiltin } from './utils/builtins';
import { execFindDependency } from './utils/exec';
import {
  findFunctionScope,
  isBeforeCommand,
  isCommand,
  isFunctionDefinition,
  isStatement,
  isVariable,
} from './utils/node-types';
import { getRange } from './utils/tree-sitter';

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

  constructor() {
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
}

// might be better to just create on the fly, and only show inlayHints for current document
// tldr signature would be nice
//export class FishSymbol

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
