import { SymbolKind, WorkspaceSymbol, Range, DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { CommentRange, symbolKindToString, toSymbolKind } from '../symbols';
import { isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition } from './node-types';
import { pathToRelativeFunctionName, uriToPath } from './translation';
import { findFirstParent, getChildNodes, getRange } from './tree-sitter';


export interface FishWorkspaceSymbol extends WorkspaceSymbol {
    name: string
    kind: SymbolKind
    location: {
        uri: string
        range:  Range
    },
    documentation: {
        text: string
        markdown: string
    }
}

export namespace FishWorkspaceSymbol {
    export function create(name: string, kind: SymbolKind, uri: string, range: Range, markdown: string): FishWorkspaceSymbol {
        return {
            name: name,
            kind: kind,
            location: {
                uri: uri,
                range: range,
            },
            documentation: {
                text: [
                    `${symbolKindToString(kind).toLowerCase()} ${name}`,
                    `defined in file: '${uriToPath(uri)}'`,
                ].join("\n"),
                markdown: markdown,
            },
        };
    }

    export function areEqual(a: FishWorkspaceSymbol, b: FishWorkspaceSymbol): boolean {
        return (
            a.name === b.name &&
            a.location.uri === b.location.uri &&
            a.location.range.start.line === b.location.range.start.line &&
            a.location.range.start.character ===
                b.location.range.start.character
        );
    }
}

export namespace MarkdownDocumentation {
    export function create(node: SyntaxNode, uri: string): string {
        const path = uriToPath(uri) || uri
        const commentRange = CommentRange.create(node)
        if (isFunctionDefinitionName(node)) {
            return [
                `\*(function)* \**${node.text}**`,
                `defined in file: '${path}'`,
                '___',
                commentRange.markdown()
            ].join('\n')
        } else if (isVariableDefinition(node)) {
            const parentNode = node.parent || node
            const withCommentText = isFunctionDefinition(parentNode) ? parentNode.text.toString() : commentRange.text()
            return [
                `\*(variable)* \**${node.text}**`,
                `defined in file: '${path}'`,
                "___",
                "```fish",
                `${withCommentText.trim()}`,
                "```",
            ].join("\n")
        }
        return [
            "```fish",
            node.text,
            "```"
        ].join('\n');
    }
}

export function collectFishWorkspaceSymbols(root: SyntaxNode, uri: DocumentUri) : FishWorkspaceSymbol[] {
    const symbols: FishWorkspaceSymbol[] = [];
    const nodes = getChildNodes(root)
        .filter(node => isDefinition(node))
        .filter(node => {
            const scope = DefinitionSyntaxNode.getScope(node, uri)
            return scope === "global";
    })
    for (const node of nodes) {
        const name = node.text;
        const kind = toSymbolKind(node);
        const range = getRange(node);
        const docs = MarkdownDocumentation.create(node, uri);
        const symbol = FishWorkspaceSymbol.create(name, kind, uri, range, docs);
        symbols.push(symbol);
    }
    return symbols;
}


export namespace DefinitionSyntaxNode {
    export const ScopeTypesSet = new Set(["global", "function", "local", "block"]);
    export type ScopeTypes = "global" | "function" | "local" | "block";
    export type VariableCommandNames = "set" | "read" | "for" | "function" // FlagsMap.keys()
    export interface CommandOption {
        short: string[]
        long: string[]
        isDefault: boolean
    }
    export class CommandOption {
        constructor(short: string[], long: string[], isDefault: boolean) {
            this.short = short;
            this.long = long;
            this.isDefault = isDefault;
        }
        has(option: string): boolean {
            if (option.startsWith('--')) {
                const withoutDash = option.slice(2);
                return this.long.includes(withoutDash);
            } else if (option.startsWith('-')) {
                const withoutDash = option.slice(1);
                return this.short.some(opt => withoutDash.split('').includes(opt));
            } else {
                return false;
            }
        }
        toString() {
            return '[' + this.short.map(s => '-'+s).join(', ') + ', ' + this.long.map(l => '--'+l).join(', ') + ']';
            //return returnString;
        }
    }
    const createFlags = (flags: string[], isDefault: boolean = false): CommandOption => {
        return new CommandOption(
            flags.filter((flag) => flag.startsWith("-") && flag.length === 2).map((flag) => flag.slice(1)),
            flags.filter((flag) => flag.startsWith("--")).map((flag) => flag.slice(2)), 
            isDefault
        );
    }
    const _Map = {
        read: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        set: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        for: {
            block: createFlags([]) 
        },
        function: { 
            function: createFlags(["-A", "--argument-names", "-v", "--on-variable"], true)   ,
            global:   createFlags(["-V", "--inherit-variable", '-S', '--no-scope-shadowing']),
        },
    }
    export const FlagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => {
        return [command, new Map(Object.entries(scopes).map(([scope, flags]) => {
            return [scope, flags];
        }))];
    }));
    function collectFlags(cmdNode: SyntaxNode): string[] {
        return cmdNode.children
            .filter((n) => n.text.startsWith("-"))
            .map((n) => n.text);
    }
    export const getScope = (definitionNode: SyntaxNode, uri: string) => {
        if (!isDefinition(definitionNode)) return null;
        if (definitionNode.text.startsWith("$") || definitionNode.text === "argv" || definitionNode.text.endsWith("]")) return 'local';
        if (isFunctionDefinitionName(definitionNode)) {
            const loadedName = pathToRelativeFunctionName(uri);
            return loadedName === definitionNode.text || loadedName.endsWith('config') ? "global" : "local";
        }
        const command = findFirstParent(definitionNode, isCommandName) || definitionNode.parent;
        const commandName = command?.firstChild?.text || "";
        if (!command || !commandName) return null
        const currentFlags = collectFlags(command)
        let saveScope : string = 'local';
        for (const [scope, scopeFlags] of FlagsMap.get(commandName)!.entries()) {
            if (currentFlags.some(flag => scopeFlags.has(flag))) {
                return scope
            } else if (scopeFlags.isDefault) {
                saveScope = scope
            }
        }
        return saveScope
    }
}


