import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import { isDefinition, isVariableDefinition, isFunctionDefinitionName } from "./node-types";

const isLongOption = (text: string): boolean => text.startsWith('--');
const isShortOption = (text: string): boolean => text.startsWith('-') && !isLongOption(text);
const isOption = (text: string): boolean => isShortOption(text) || isLongOption(text);

export interface FishFlagOption {
    name: string;
    shortFlags: string;
    longFlags: string;
    storeNextValues: 'none' | 'single' | 'multi', 
    combinable: boolean;
    stored: string[];
}

export const FunctionOpts: FishFlagOption[] = [
    {
        name: "description",
        shortFlags: "d",
        longFlags: "description",
        storeNextValues: "single",
        combinable: false,
        stored: [],
    },
    {
        name: "arguments",
        shortFlags: "a",
        longFlags: "argument-names",
        storeNextValues: "multi",
        combinable: false,
        stored: [],
    },
    {
        name: "inherits variable",
        shortFlags: "V",
        longFlags: "inherit-variable",
        storeNextValues: "multi",
        combinable: false,
        stored: [],
    },
    {
        name: "no scope shadowing",
        shortFlags: "S",
        longFlags: "no-scope-shadowing",
        storeNextValues: "none",
        combinable: false,
        stored: [],
    },
];

export const VariableOpts: FishFlagOption[] = [
    {
        name: "locally",
        shortFlags: "l",
        longFlags: "local",
        storeNextValues: "none",
        combinable: true,
        stored: [],
    },
    {
        name: "exported",
        shortFlags: "x",
        longFlags: "export",
        storeNextValues: "none",
        combinable: true,
        stored: [],
    },
    {
        name: "globally",
        shortFlags: "g",
        longFlags: "global",
        storeNextValues: "none",
        combinable: true,
        stored: [],
    },
    {
        name: "universally",
        shortFlags: "U",
        longFlags: "universal",
        storeNextValues: "none",
        combinable: true,
        stored: [],
    },
];

function filterFishFlagOption(node: SyntaxNode, options: FishFlagOption[]): FishFlagOption[] {
    if (!isOption(node.text)) return []
    if (isShortOption(node.text)) {
        const shortFlag = node.text.slice(1);
        if (options.some((opt) => opt.combinable)) {
            const currentFlags = shortFlag.split('');
            return options.filter((opt) => currentFlags.some((cFlag) => cFlag === opt.shortFlags))
        }
        return options.filter((opt) => shortFlag === opt.shortFlags)
    }
    if (isLongOption(node.text)) {
        const longFlag = node.text.slice(2);
        return options.filter((opt) => longFlag === opt.longFlags)
    }
    return []
}

function storeNextValues(node: SyntaxNode | null, option: FishFlagOption) {
    let current: SyntaxNode | null = node?.nextSibling || null;
    if (!current) return option;
    switch (option.storeNextValues) {
        case 'none':
            break;
        case 'single':
            if (current.nextSibling) option.stored.push(current.nextSibling.text)
            break;
        case 'multi':
            while (current && current.type !== '\n' && !isOption(current.text)) {
                option.stored.push(current.text);
                current = current.nextSibling;
            }
            break;
    }
    return option;
}

export function findAllOptions(node: SyntaxNode, options: FishFlagOption[]) {
    let current: SyntaxNode | null = node;
    const matchingOpts: FishFlagOption[] = [];
    while (current && current.type !== '\n') {
        if (isOption(current.text)) {
            matchingOpts.push(
                ...filterFishFlagOption(current, options).map(
                    (opt) => storeNextValues(current, opt)
                )
            )
        }
        current = current.nextSibling;
    }
    return matchingOpts.sort((a, b) => options.indexOf(a) - options.indexOf(b));
}


export function findOptionString(node: SyntaxNode) {
    if (!isDefinition(node)) return null
    if (isVariableDefinition(node)) {
        const parent = node.parent?.firstChild;
        if (!parent) return "locally scoped"
        const opts = findAllOptions(parent, VariableOpts).map((opt) => opt.name);
        if (opts.length === 0) return "locally scoped"
        return opts.join(' and ') + ' scoped'
    }
    if (isFunctionDefinitionName(node)) {
        const opts = findAllOptions(node, FunctionOpts);
        if (opts.length === 0) return null;
        return opts.map((opt) => {
            switch (opt.name) {
                case "description":
                    return opt.stored[0];
                case "arguments":
                    return opt.stored.map((arg, index) => `\t(argument) ${arg} $argv[${index}]`).join('\n');
                case "inherits variable":
                    return opt.stored.map((varName) => `\t$inherits variable ${varName}`);
                case "no scope shadowing":
                    return opt.name;
            }
        }).join('\n').trimEnd() || "";
    } 
    return null;
}
