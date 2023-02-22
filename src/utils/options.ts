import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import { isDefinition, isVariableDefinition, isFunctionDefinitionName, isFunctionDefinition } from "./node-types";

const isLongOption = (text: string): boolean => text.startsWith('--');
const isShortOption = (text: string): boolean => text.startsWith('-') && !isLongOption(text);
const isOption = (text: string): boolean => isShortOption(text) || isLongOption(text);

// rework this class to be simpler/shorter, and then use it in 
// ../document-symbol.ts


export interface FishFlagOption {
    name: string;
    shortFlags: string;
    longFlags: string;
    storeNextValues: 'none' | 'single' | 'multi', 
    combinable: boolean;
    stored: string[];
    selected: string;
    toString(): string;
}

class FunctionOption implements FishFlagOption {
    private _selected: string = ""

    constructor(
        public name: string = name,
        public shortFlags: string = shortFlags,
        public longFlags: string = longFlags,
        public storeNextValues: 'none' | 'single' | 'multi'  = storeNextValues,
        public combinable = false,
        public stored: string[] = [],
    ) {}

    public set selected(value: string) { this._selected = value; }
    public get selected(): string { return this._selected; }

    toString(): string {
        switch (this.name) {
            case "description":
                if (this?.stored) {
                    return '--' + this?.stored.join(' ')
                }
            case "arguments":
                if (this.selected === "") {
                    return this.stored.map((arg, index) => `\t(argument) ${arg} $argv[${index + 1}]`).join('\n');
                } else {
                    return this.stored.map((arg, index) => {
                        if (arg === this.selected) {
                            return `\t(argument) \**${arg}** $argv[${index + 1}] (match)`
                        }
                        return `\t(argument) ${arg} $argv[${index + 1}]`
                    }).join('\n');
                }
            case "inherits variable":
                return this.stored.map((varName) => `\t$inherits variable ${varName}`).join('\n');
            case "no scope shadowing":
            default: 
                return `${this.name}`
        }

    }
}

function createFunctionOption(name: string, shortFlags: string, longFlags: string, storeNextValues: 'none' | 'single' | 'multi'): FunctionOption {
    return new FunctionOption(name, shortFlags, longFlags, storeNextValues);
}

function getFunctionOpts(selectedNode: SyntaxNode): FishFlagOption[]{
    return [
        createFunctionOption("description", "d", "description", "single"),
        createFunctionOption("arguments", "a", "argument-names", "multi"),
        createFunctionOption("inherits variable", "V", "inherit-variable", "multi"),
        createFunctionOption("no scope shadowing", "S", "no-scope-shadowing", "none"),
    ].map((opt) => {
        opt.selected = selectedNode.text;
        return opt;
    })
}

class VariableOption implements FishFlagOption {
    private _selected: string = ""

    constructor(
        public name: string = name,
        public shortFlags: string = shortFlags,
        public longFlags: string = longFlags,
        public storeNextValues: 'none' | 'single' | 'multi'  = 'none',
        public combinable = true,
        public stored: string[] = [],
    ) {}

    public set selected(value: string) { this._selected = value; }
    public get selected(): string { return this._selected; }

    toString(): string {
        switch (this.name) {
            case "locally":
            case "globally":
            case "universally":
                return `${this.name} scoped`;
            case "exported":
            default: 
                return `${this.name}`
        }

    }
}    

function createVariableOption(name: string, shortFlags: string, longFlags: string): VariableOption {
    return new VariableOption(name, shortFlags, longFlags);
}

function getLocalOption(selectedNode: SyntaxNode): FishFlagOption[] {
    return [
        createVariableOption("locally","l","local")
    ].map((opt) => {
        opt.selected = selectedNode.text;
        return opt;
    });
}

function getVariableOpts(selectedNode: SyntaxNode): FishFlagOption[]{
    return [
        createVariableOption("locally","l","local"),
        createVariableOption("globally","g","global"),
        createVariableOption("universally","U","universal"),
        createVariableOption("exported","x","export"),
    ].map((opt) => {
        opt.selected = selectedNode.text;
        return opt;
    })
}

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


//export function findOptionString(node: SyntaxNode) {
    //if (!isDefinition(node)) return null
    //if (isVariableDefinition(node)) {
        //const parent = node.parent?.firstChild;
        //if (!parent) return "locally scoped"
        //const opts = findAllOptions(parent, VariableOpts).map((opt) => opt.name);
        //if (opts.length === 0) return "locally scoped"
        //return opts.join(' and ') + ' scoped'
    //}
    //if (isFunctionDefinitionName(node)) {
        //const opts = findAllOptions(node, FunctionOpts);
        //if (opts.length === 0) return null;
        //return opts.map((opt) => {
            //switch (opt.name) {
                //case "description":
                    //return opt.stored[0];
                //case "arguments":
                    //return opt.stored.map((arg, index) => `\t(argument) ${arg} $argv[${index}]`).join('\n');
                //case "inherits variable":
                    //return opt.stored.map((varName) => `\t$inherits variable ${varName}`);
                //case "no scope shadowing":
                    //return opt.name;
            //}
        //}).join('\n').trimEnd() || "";
    //}
    //return null;
//}

export function optionTagProvider(child: SyntaxNode, parent: SyntaxNode | null) {
    let tags: FishFlagOption[] = []
    if (!parent) {
        //console.log('parent was null');
        return []
    }
    //console.log(JSON.stringify({parent: parent.text, child: child.text}, null, 2));
    if (isFunctionDefinition(parent)) {
        //console.log("FUNCTION DEFINITION");
        tags = findAllOptions(parent.firstChild || child, getFunctionOpts(child))
    } else if (isVariableDefinition(child)) {
        //console.log("VARIABLE DEFINITION");
        const results = findAllOptions(parent.firstChild || child, getVariableOpts(child));
        if (results.length === 0) tags = getLocalOption(child)
        tags = results;
    }
    return tags
}
