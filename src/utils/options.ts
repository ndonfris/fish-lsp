import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import { isDefinition, isVariableDefinition, isFunctionDefinitionName, isFunctionDefinition, isLongOption, isShortOption, isOption } from "./node-types";

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
                return `${this.selected} --  ${this.stored?.at(0)}`
            case "arguments":
                if (this.selected === "") {
                    return this.stored.map((arg, index) => `\t(argument) ${arg} $argv[${index + 1}]`).join('\n');
                } else {
                    return this.stored.map((arg, index) => {
                        if (arg === this.selected) {
                            return `\t(argument) \**${arg}** \$argv[${index + 1}] (match)`
                        }
                        return `\t(argument) ${arg} $argv[${index + 1}]`
                    }).join('\n');
                }
            case "inherits variable":
                return this.stored.map((varName) => `\tinherits variable ${varName}`).join('\n');
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
    if (!isOption(node)) return []
    if (isShortOption(node)) {
        const shortFlag = node.text.slice(1);
        if (options.some((opt) => opt.combinable)) {
            const currentFlags = shortFlag.split('');
            return options.filter((opt) => currentFlags.some((cFlag) => cFlag === opt.shortFlags))
        }
        return options.filter((opt) => shortFlag === opt.shortFlags)
    }
    if (isLongOption(node)) {
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
            if (current) option.stored.push(current.text)
            break;
        case 'multi':
            while (current && current.type !== '\n' && !isOption(current)) {
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
        if (isOption(current)) {
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

export function findFunctionDefinitionOptions(funcNode: SyntaxNode, node: SyntaxNode) {
    const functionOptions = [
        createFunctionOption("arguments", "a", "argument-names", "multi"),
        createFunctionOption("inherits variable", "V", "inherit-variable", "multi"),
    ]
    return findAllOptions(funcNode, functionOptions).filter((opt) => {
            return opt.stored.some((storedOpt) => storedOpt === node.text)
        }
    ).length > 0;
}

export function optionTagProvider(child: SyntaxNode, parent: SyntaxNode | null) {
    let tags: FishFlagOption[] = []
    if (!parent) {return []}
    if (isFunctionDefinition(parent)) {
        tags = findAllOptions(parent.firstChild || child.parent!, getFunctionOpts(child))
    } else if (isVariableDefinition(child)) {
        const results = findAllOptions(parent.firstChild || child.parent || child, getVariableOpts(child));
        tags = results;
        if (results.length === 0) tags = getLocalOption(child)
    }
    return tags
}

export function getScopeTags() {

}
